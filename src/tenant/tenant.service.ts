import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { PrismaService } from 'prisma/prisma.service';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createTenantDto: CreateTenantDto) {
    const existing = await this.prisma.tenant.findUnique({
      where: { slug: createTenantDto.slug },
    });
    if (existing) {
      throw new ConflictException('Tenant with this slug already exists');
    }
    return this.prisma.tenant.create({
      data: createTenantDto,
    });
  }

  findAll() {
    return this.prisma.tenant.findMany();
  }

  async findOne(slug: string) {
    const existingSlug = await this.prisma.tenant.findUnique({
      where: { slug },
    });
    if (!existingSlug) {
      throw new NotFoundException('user not found');
    }
    return existingSlug;
  }

  async update(slug: string, updateTenantDto: UpdateTenantDto) {
    await this.findOne(slug);
    return this.prisma.tenant.update({
      where: { slug },
      data: updateTenantDto,
    });
  }

  async remove(slug: string) {
    await this.findOne(slug);
    return this.prisma.tenant.delete({
      where: { slug },
    });
  }
}
