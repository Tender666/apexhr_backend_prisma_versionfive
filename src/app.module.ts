import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TenantModule } from './tenant/tenant.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [TenantModule, AuthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
