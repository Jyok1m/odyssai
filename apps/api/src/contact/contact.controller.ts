import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ContactRequestSchema } from '@odyssai/schemas';
import { ContactService } from './contact.service.js';

/*
  Ouvert a qui n'a pas de compte : exiger une session ferait taire un visiteur
  qui n'arrive pas a s'inscrire. Rien n'est rendu que le succes, le message
  etant enregistre avant l'envoi.
*/
@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async submit(@Body() body: unknown): Promise<{ received: true }> {
    await this.contact.submit(ContactRequestSchema.parse(body));
    return { received: true };
  }
}
