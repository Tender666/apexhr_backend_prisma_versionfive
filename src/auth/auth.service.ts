import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { RegisterDto } from './dto/register.dto';
import { PrismaService } from 'prisma/prisma.service';
import { TenantService } from 'src/tenant/tenant.service';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { JwtService } from '@nestjs/jwt';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly tenantService: TenantService,
    private readonly jwtService: JwtService,
  ) {}

  // ─────────────────────────────────────────────
  // REGISTRATION
  // ─────────────────────────────────────────────

  async register(dto: RegisterDto) {
    // Verify the tenant exists before creating a user under it
    const tenant = await this.tenantService.findOne(dto.tenantSlug);

    
    const existingUser = await this.prismaService.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException('A user with this email already exists');
    }

    // Hash password 
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prismaService.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        firstName: dto.firstName,
        lastName: dto.lastName,
        tenantId: tenant.id,
        role: dto.role ?? Role.EMPLOYEE,       
        departmentId: dto.departmentId ?? null, 
      },
    });

    return { user, message: 'user account for tenant successfully created' };
  }

  // ─────────────────────────────────────────────
  // LOGIN
  // ─────────────────────────────────────────────

  async login(dto: LoginDto) {
    // Look up user by email
    const user = await this.prismaService.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid Credentials');
    }

    // Verify the provided password against the stored hash
    const passwordMatch = await bcrypt.compare(dto.password, user.password);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid Credentials');
    }

    // Strip password from the response payload
    const { password, ...userWithoutPassword } = user;

    // Issue access + refresh tokens
    const tokens = await this.generateUserToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    });

    return {
      user: userWithoutPassword,
      message: 'Successfully logged IN',
      ...tokens,
    };
  }

  // ─────────────────────────────────────────────
  // LOGOUT
  // ─────────────────────────────────────────────

  async logout(refreshToken: string) {
    // Validate that the token exists before attempting deletion
    const token = await this.prismaService.refreshToken.findUnique({
      where: { token: refreshToken },
    });

    if (!token) {
      throw new UnauthorizedException('Invalid refresh Token');
    }

    // Revoke the token by removing it from the DB
    await this.prismaService.refreshToken.delete({
      where: { id: token.id },
    });

    return { message: 'Successfully logged out' };
  }

  // ─────────────────────────────────────────────
  // TOKEN MANAGEMENT
  // ─────────────────────────────────────────────

  /**
   * Generates a signed JWT access token and a UUID-based refresh token.
   * The refresh token is persisted in the DB with a 7-day expiry.
   */
  async generateUserToken(payload: {
    userId: string;
    email: string;
    role: Role;
    tenantId: string;
  }) {
    const accessToken = this.jwtService.sign(payload);

    // Refresh token is a plain UUID 
    const refreshToken = uuidv4();

    await this.prismaService.refreshToken.create({
      data: {
        token: refreshToken,
        userId: payload.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    return { accessToken, refreshToken };
  }

  /**
   * Validates a refresh token, rotates it (old one deleted, new one issued),
   * and returns a fresh token pair.
   */
  async refreshToken(refreshToken: string) {
    const token = await this.prismaService.refreshToken.findUnique({
      where: { token: refreshToken },
    });

    if (!token) {
      throw new UnauthorizedException('Invalid refresh Token');
    }

    // Guard against expired tokens — clean them up on detection
    if (token.expiresAt < new Date()) {
      await this.prismaService.refreshToken.delete({
        where: { id: token.id },
      });
      throw new UnauthorizedException(
        'Refresh token expired, please log in again',
      );
    }

    const user = await this.prismaService.user.findUnique({
      where: { id: token.userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Rotate: delete current token before issuing a new pair
    await this.prismaService.refreshToken.delete({
      where: { id: token.id },
    });

    return this.generateUserToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    });
  }

  // ─────────────────────────────────────────────
  // UTILITY / PLACEHOLDER METHODS
  // ─────────────────────────────────────────────

  /** Returns all users — intended for admin/debug use */
  findAll() {
    return this.prismaService.user.findMany();
  }

  // TODO: Implement proper single-user lookup
  findOne(id: number) {
    return `This action returns a #${id} auth`;
  }

  // TODO: Implement user removal logic
  remove(id: number) {
    return `This action removes a #${id} auth`;
  }
}