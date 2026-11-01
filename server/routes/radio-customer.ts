import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { getListener, ListenerError } from '../radio/listeners';
import { CustomerStations, customerBrandSchema, customerStationLimits } from '../radio/customer-stations';
import { websiteOrigins } from '../hq/publicWebsite';

export function customerRadioRouter(options: { root: string; enabled?: () => boolean; origins?: () => string[] }) {
  const router = Router();
  const stations = new CustomerStations(options.root);
  const enabled = options.enabled || (() => process.env.RADIO_CUSTOMER_WORKSPACES_ENABLED === 'true');
  async function authorize(req: Request) {
    const account = await getListener(req.cookies?.ifcdc_radio_listener || '');
    if (!account) throw new ListenerError(401, 'Sign in with your listener account first.');
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (!(options.origins || websiteOrigins)().includes(req.get('origin') || '') || req.get('x-radio-client') !== 'website') throw new ListenerError(403, 'Use the IFCDC Radio website to update your station.');
      if (!enabled() && req.method !== 'DELETE') throw new ListenerError(503, 'Customer workspaces are not open yet.');
    }
    return account.id as string;
  }
  const wrap = (fn: (req: Request, res: Response, owner: string) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    authorize(req).then(owner => fn(req, res, owner)).catch(next);
  };
  let inFlightUploads = 0;
  const beforeUpload = (req: Request, res: Response, next: NextFunction) => {
    authorize(req).then(() => {
      if (inFlightUploads >= 2) throw new ListenerError(429, 'Uploads are busy. Wait a moment and try again.');
      inFlightUploads++;
      let released = false;
      const release = () => { if (!released) { released = true; inFlightUploads--; } };
      res.once('finish', release); res.once('close', release);
      next();
    }).catch(next);
  };
  const ids = z.array(z.string().uuid()).min(1).max(customerStationLimits.tracks);
  const stationId = (req: Request) => z.string().uuid().parse(req.params.id);
  router.get('/', wrap(async (_req, res, owner) => res.json({ enabled: enabled(), limits: customerStationLimits, stations: await stations.list(owner), subscription: 'not_available' })));
  router.post('/', express.json({ limit: '8kb' }), wrap(async (req, res, owner) => res.status(201).json({ station: await stations.create(owner, customerBrandSchema.parse(req.body)) })));
  router.get('/:id', wrap(async (req, res, owner) => res.json(await stations.state(owner, stationId(req)))));
  router.patch('/:id', express.json({ limit: '8kb' }), wrap(async (req, res, owner) => { await stations.update(owner, stationId(req), customerBrandSchema.parse(req.body)); res.sendStatus(204); }));
  // Raw body parsing follows authentication and CSRF validation, before any file work.
  const raw = (limit: string) => express.raw({ type: ['audio/mpeg', 'image/png', 'image/jpeg', 'image/webp'], limit });
  router.post('/:id/library', beforeUpload, raw('25mb'), wrap(async (req, res, owner) => {
    const title = z.string().trim().min(1).max(200).parse(req.query.title);
    const rights = req.get('x-radio-upload-rights');
    if (rights !== 'confirmed') throw new ListenerError(400, 'Confirm you have permission to upload and use this music.');
    const result = await stations.upload(owner, stationId(req), title, req.body);
    res.status(result.duplicate ? 200 : 201).json(result);
  }));
  router.get('/:id/library/:track/audio', wrap(async (req, res, owner) => res.type('audio/mpeg').sendFile(await stations.media(owner, stationId(req), z.string().uuid().parse(req.params.track)))));
  router.delete('/:id/library/:track', wrap(async (req, res, owner) => { await stations.removeTrack(owner, stationId(req), z.string().uuid().parse(req.params.track)); res.sendStatus(204); }));
  router.post('/:id/logo', beforeUpload, raw('1mb'), wrap(async (req, res, owner) => { await stations.logo(owner, stationId(req), req.body); res.sendStatus(204); }));
  router.get('/:id/logo', wrap(async (req, res, owner) => { const logo = await stations.readLogo(owner, stationId(req)); res.type(logo.type).send(logo.bytes); }));
  router.post('/:id/crates', express.json({ limit: '8kb' }), wrap(async (req, res, owner) => {
    const body = z.object({ name: z.string().trim().min(1).max(80), tracks: ids }).strict().parse(req.body);
    res.status(201).json(await stations.saveCrate(owner, stationId(req), body.name, body.tracks));
  }));
  router.post('/:id/schedule', express.json({ limit: '8kb' }), wrap(async (req, res, owner) => {
    const body = z.object({ title: z.string().trim().min(1).max(80), start: z.string().datetime(), tracks: ids }).strict().parse(req.body);
    res.status(201).json(await stations.schedule(owner, stationId(req), body));
  }));
  for (const kind of ['crates', 'slots'] as const) router.delete(`/:id/${kind}/:item`, wrap(async (req, res, owner) => { await stations.removeItem(owner, stationId(req), kind, z.string().uuid().parse(req.params.item)); res.sendStatus(204); }));
  router.delete('/:id', wrap(async (req, res, owner) => { await stations.remove(owner, stationId(req)); res.sendStatus(204); }));
  router.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = error instanceof z.ZodError ? 400 : error instanceof ListenerError ? error.status : error.type === 'entity.too.large' ? 413 : 503;
    res.status(status).json({ error: status === 400 && error instanceof z.ZodError ? 'Check your station fields and track selection.' : status === 413 ? 'That file exceeds the upload size limit.' : status === 503 ? 'Customer station storage is unavailable. Contact IFCDC.' : error.message });
  });
  return router;
}
