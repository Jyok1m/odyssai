import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ContactRequestSchema } from '@odyssai/schemas';
import { ContactService } from './contact.service.js';

/*
  Le formulaire de contact, ouvert a qui n'a pas de compte : c'est souvent
  celui-la qui a le plus besoin d'ecrire, et exiger une session ferait taire
  un visiteur qui n'arrive pas a s'inscrire.

  Rien n'est rendu que le succes. Le message est enregistre avant d'etre
  envoye, donc un serveur de messagerie en panne n'est pas une erreur du point
  de vue de celui qui ecrit.
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
