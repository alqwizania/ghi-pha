import { Context, Next } from 'hono';
import { jwt } from 'hono/jwt';

export const authMiddleware = (secret: string) => {
    return async (c: Context, next: Next) => {
        const middleware = jwt({
            secret: secret,
            alg: 'HS256',
        });
        return middleware(c, next);
    };
};

export const checkRole = (roles: string[]) => {
    return async (c: Context, next: Next) => {
        const payload = c.get('jwtPayload');
        if (!payload || !roles.includes(payload.role)) {
            return c.json({ error: 'Unauthorized: Insufficient permissions' }, 403);
        }
        await next();
    };
};
