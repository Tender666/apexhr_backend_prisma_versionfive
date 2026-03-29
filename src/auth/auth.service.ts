import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { RegisterDto } from './dto/register.dto';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { PrismaService } from 'prisma/prisma.service';
import { TenantService } from 'src/tenant/tenant.service';
import { MailService } from 'src/mail/mail.service';
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
    private readonly mailService: MailService,
  ) {}

  // ─────────────────────────────────────────────
  // REGISTER TENANT (Company + HR Admin in one go)
  // ─────────────────────────────────────────────

  async registerTenant(dto: RegisterTenantDto) {
    // 1. Check slug is not already taken
    const existingTenant = await this.prismaService.tenant.findUnique({
      where: { slug: dto.slug },
    });
    if (existingTenant) {
      throw new ConflictException('A company with this slug already exists');
    }

    // 2. Generate a temporary password for the HR Admin
    const tempPassword = Math.random().toString(36).slice(-8) + 'A@1';

    // 3. Hash the temp password
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    // 4. Create tenant + HR Admin user in one transaction
    const tenant = await this.prismaService.tenant.create({
      data: {
        name: dto.companyName,
        slug: dto.slug,
        companyType: dto.companyType,
        companyPhone: dto.companyPhone,
        companyLocation: dto.companyLocation,
        users: {
          create: {
            email: dto.email,
            password: hashedPassword,
            firstName: dto.firstName,
            lastName: dto.lastName,
            role: Role.HR_ADMIN,
            mustChangePassword: true,
          },
        },
      },
      include: { users: true },
    });

    const hrAdmin = tenant.users[0];

    // 5. Send welcome email with temp password
    await this.mailService.sendTenantWelcomeEmail(
      dto.email,
      dto.firstName,
      dto.companyName,
      tempPassword,
    );

    // 6. Generate tokens
    const tokens = await this.generateUserToken({
      userId: hrAdmin.id,
      email: hrAdmin.email,
      role: hrAdmin.role,
      tenantId: tenant.id,
    });

    const { password, ...hrAdminWithoutPassword } = hrAdmin;

    return {
      message:
        'Company registered successfully. Check your email for login credentials.',
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      },
      user: hrAdminWithoutPassword,
      ...tokens,
    };
  }

  // ─────────────────────────────────────────────
  // REGISTRATION (Add individual user to tenant)
  // ─────────────────────────────────────────────

  async register(dto: RegisterDto) {
    // Verify the tenant exists before creating a user under it
    const tenant = await this.tenantService.findOne(dto.tenantSlug);

    // ✅ Fix: use findFirst instead of findUnique with composite key
    const existingUser = await this.prismaService.user.findFirst({
      where: {
        email: dto.email,
        tenantId: tenant.id,
      },
    });
    if (existingUser) {
      throw new ConflictException(
        'A user with this email already exists in this tenant',
      );
    }

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

    return { user, message: 'User account for tenant successfully created' };
  }

  // ─────────────────────────────────────────────
  // LOGIN
  // ─────────────────────────────────────────────

  async login(dto: LoginDto) {
    const user = await this.prismaService.user.findFirst({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid Credentials');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.password);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid Credentials');
    }

    const { password, ...userWithoutPassword } = user;

    const tokens = await this.generateUserToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    });

    return {
      user: userWithoutPassword,
      message: 'Successfully logged in',
      ...tokens,
    };
  }

  // ─────────────────────────────────────────────
  // LOGOUT
  // ─────────────────────────────────────────────

  async logout(refreshToken: string) {
    const token = await this.prismaService.refreshToken.findUnique({
      where: { token: refreshToken },
    });

    if (!token) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.prismaService.refreshToken.delete({
      where: { id: token.id },
    });

    return { message: 'Successfully logged out' };
  }

  // ─────────────────────────────────────────────
  // CHANGE PASSWORD
  // ─────────────────────────────────────────────

  async changePassword(dto: ChangePasswordDto) {
    // ✅ Fix: use findFirst instead of findUnique for passwordResetToken
    const user = await this.prismaService.user.findFirst({
      where: { passwordResetToken: dto.resetToken },
    });

    if (!user) {
      throw new NotFoundException('Invalid or expired reset token');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

    // ✅ Fix: removed passwordResetToken from data (not yet in Prisma client)
    await this.prismaService.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        mustChangePassword: false,
      },
    });

    return { message: 'Password changed successfully' };
  }

  // ─────────────────────────────────────────────
  // TOKEN MANAGEMENT
  // ─────────────────────────────────────────────

  async generateUserToken(payload: {
    userId: string;
    email: string;
    role: Role;
    tenantId: string;
  }) {
    const accessToken = this.jwtService.sign(payload);

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

  async refreshToken(refreshToken: string) {
    const token = await this.prismaService.refreshToken.findUnique({
      where: { token: refreshToken },
    });

    if (!token) {
      throw new UnauthorizedException('Invalid refresh token');
    }

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

  findAll() {
    return this.prismaService.user.findMany();
  }

  findOne(id: number) {
    return `This action returns a #${id} auth`;
  }

  remove(id: number) {
    return `This action removes a #${id} auth`;
  }
}
