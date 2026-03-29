import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('MAIL_HOST'),
      port: this.configService.get<number>('MAIL_PORT'),
      secure: false,
      auth: {
        user: this.configService.get<string>('MAIL_USER'),
        pass: this.configService.get<string>('MAIL_PASS'),
      },
    });
  }

  async sendTenantWelcomeEmail(
    to: string,
    firstName: string,
    tenantName: string,
    tempPassword: string,
  ) {
    await this.transporter.sendMail({
      from: this.configService.get<string>('MAIL_FROM'),
      to,
      subject: `Welcome to ApexHR — ${tenantName}`,
      html: `
        <h2>Welcome to ApexHR, ${firstName}!</h2>
        <p>Your company <strong>${tenantName}</strong> has been registered.</p>
        <p>Your temporary password is: <strong>${tempPassword}</strong></p>
        <p>You will be required to change your password on first login.</p>
        <p>Do not share this password with anyone.</p>
      `,
    });
  }
}