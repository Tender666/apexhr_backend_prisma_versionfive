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

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly tenantService: TenantService,
  ) {}

  async register(dto: RegisterDto) {
    const tenant = await this.tenantService.findOne(dto.tenantSlug);

    const existingUser = await this.prismaService.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException('A user with this email already exists');
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

    return user;
  }

  async login(dto: LoginDto) {
    const user = await this.prismaService.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid Credentials');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.password);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid Credentials');
    }

    return user;
  }

  findOne(id: number) {
    return `This action returns a #${id} auth`;
  }

  findAll() {
    return this.prismaService.user.findMany();
  }

  remove(id: number) {
    return `This action removes a #${id} auth`;
  }
}
