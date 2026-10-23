import { FastifyRequest, FastifyReply } from 'fastify';

export type TokenType = 'access' | 'refresh';

export interface TokenPayload {
  userId: string;
  email: string;
  type: TokenType;
}

/**
 * Проверяет JWT запроса и убеждается, что это именно access-токен.
 * Refresh-токен (в том числе из cookie, которую @fastify/jwt читает как запасной источник)
 * не должен давать доступ к API.
 */
export async function verifyAccessToken(request: FastifyRequest): Promise<void> {
  await request.jwtVerify();
  if ((request.user as Partial<TokenPayload>)?.type !== 'access') {
    throw new Error('Invalid token type');
  }
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await verifyAccessToken(request);
  } catch (err) {
    reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Требуется авторизация или срок действия токена истек',
    });
  }
}
