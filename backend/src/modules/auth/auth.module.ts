import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthResolver } from './auth.resolver';
import { AuthEmailResolver } from './auth-email.resolver';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../prisma.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET || 'dev-secret',
        signOptions: { expiresIn: '7d' },
      }),
    }),
    MailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthResolver, AuthEmailResolver, JwtStrategy, PrismaService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
