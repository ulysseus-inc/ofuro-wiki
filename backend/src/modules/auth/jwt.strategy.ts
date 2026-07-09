import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { JwtPayload } from './auth.service';
import { PrismaService } from '../../prisma.service';

function extractJwtFromCookie(req: Request): string | null {
  return req?.cookies?.affine_token ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    const secret = process.env.JWT_SECRET || 'dev-secret';
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        extractJwtFromCookie,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload) {
    // L-1: トークンの tokenVersion を DB と突き合わせ、失効済みトークンを拒否する。
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, tokenVersion: true },
    });
    if (!user || (payload.tv ?? 0) !== user.tokenVersion) {
      throw new UnauthorizedException('Token has been revoked');
    }
    return { id: user.id, email: user.email };
  }
}
