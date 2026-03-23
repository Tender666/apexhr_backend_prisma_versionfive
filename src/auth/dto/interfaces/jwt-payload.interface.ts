import { Role } from '@prisma/client';

export interface JwtPayLoad {
  sub: string;
  email: string;
  role: Role;
  tenantId: string;
}
