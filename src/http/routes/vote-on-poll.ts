import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { randomUUID } from 'node:crypto'
import { redis } from '../../lib/redis'
import { voting } from '../../utils/voting-pub-sub'

export default async function voteOnPoll(app: FastifyInstance) {
    app.post('/polls/:pollId/votes', async (request, reply) => {
        const voteOnPollParams = z.object({
            pollId: z.string().uuid()
        })

        const voteOnPollBody = z.object({
            pollOptionId: z.string().uuid()
        })

        const { pollId } = voteOnPollParams.parse(request.params)
        const { pollOptionId } = voteOnPollBody.parse(request.body)

        let { sessionId } = request.cookies

        if (sessionId) {
            const previousUserVoteOnPoll = await prisma.vote.findUnique({
                where: {
                    sessionId_pollId: { sessionId, pollId }
                }
            })

            if (previousUserVoteOnPoll) {
                if (previousUserVoteOnPoll.pollOptionId == pollOptionId) {
                    return reply.code(400).send({ message: 'You already voted on this poll.' })
                }

                await prisma.vote.delete({
                    where: { id: previousUserVoteOnPoll.id }
                })

                const votes = await redis.zincrby(pollId, -1, previousUserVoteOnPoll.pollOptionId)

                voting.publish(pollId, {
                    pollOptionId: previousUserVoteOnPoll.pollOptionId,
                    votes: Number(votes),
                })
            }
        }

        if (!sessionId) {
            sessionId = randomUUID()

            reply.setCookie('sessionId', sessionId, {
                path: '/',
                maxAge: 60 * 60 * 24 * 30, // 30 days
                signed: true,
                httpOnly: true
            })
        }

        await prisma.vote.create({
            data: { sessionId, pollId, pollOptionId }
        })

        const votes = await redis.zincrby(pollId, 1, pollOptionId)

        voting.publish(pollId, {
            pollOptionId,
            votes: Number(votes),
        })

        return reply.code(201).send({ sessionId })
    })
}
