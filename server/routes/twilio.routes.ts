import { Router, Request, Response } from 'express';
import twilio from 'twilio';

const router = Router();
const VoiceResponse = twilio.twiml.VoiceResponse;
const MessagingResponse = twilio.twiml.MessagingResponse;

router.post('/voice', (req: Request, res: Response) => {
  const calledNumber = req.body.To;
  const twiml = new VoiceResponse();

  if (calledNumber === '+13313168167') {
    twiml.say('Thank you for calling IFCDC Barbers. Please hold while we connect you.');
    twiml.dial('+17327435048');
  } else if (calledNumber === '+18587588791') {
    twiml.say('Thank you for calling IFCDC Radio. Please leave your shoutout after the tone.');
    twiml.record({ maxLength: 60, action: '/twiml/voicemail-complete' });
  } else {
    twiml.say('Thank you for calling Imperial Foundation Community Development Center.');
  }

  res.type('text/xml').send(twiml.toString());
});

router.post('/voicemail-complete', (req: Request, res: Response) => {
  const twiml = new VoiceResponse();
  twiml.say('Thank you for your message. Goodbye!');
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
});

router.post('/sms', (req: Request, res: Response) => {
  const calledNumber = req.body.To;
  const twiml = new MessagingResponse();

  if (calledNumber === '+13313168167') {
    twiml.message('IFCDC Barbers: Thanks for your message. To book, reply BOOK, or call us directly.');
  } else if (calledNumber === '+18587588791') {
    twiml.message('IFCDC Radio: Text your shoutout or song request here. Thanks for tapping in.');
  } else {
    twiml.message("IFCDC: We've received your message. A team member will follow up.");
  }

  res.type('text/xml').send(twiml.toString());
});

export default router;
