import { z } from 'zod';

export const loginSchema = z.strictObject({ secret: z.string().min(32).max(256) });
export const viewportSchema = z.strictObject({
  width: z.number().int().min(320).max(1920),
  height: z.number().int().min(240).max(1080),
});
export const createSessionSchema = z.strictObject({ viewport: viewportSchema });
export const navigateSchema = z.strictObject({ url: z.string().min(1).max(2048) });
export const sessionParamsSchema = z.strictObject({ id: z.uuid() });
export const browserSessionSchema = z.strictObject({
  id: z.uuid(),
  state: z.enum(['starting', 'ready', 'loading', 'failed']),
  url: z.string(),
  title: z.string(),
  viewport: viewportSchema,
  error: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
});
export const statusSchema = z.strictObject({
  phase: z.number().int().min(3).max(6),
  engine: z.literal('playwright'),
  session: browserSessionSchema.nullable(),
  capabilities: z.strictObject({
    browser: z.literal(true),
    display: z.literal(true),
    input: z.literal(true),
  }),
  allowedDomains: z.array(z.string()),
  homeUrl: z.url(),
  authExpiresAt: z.number().int(),
});
export const loginResponseSchema = z.strictObject({
  token: z.string(),
  expiresAt: z.number().int(),
});
export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type BrowserStatus = z.infer<typeof statusSchema>;
export type BrowserSession = z.infer<typeof browserSessionSchema>;
export type Viewport = z.infer<typeof viewportSchema>;

const revision = z.number().int().nonnegative();
const coordinate = z.number().finite().min(0).max(1920);
export const inputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('pointer'),
    action: z.enum(['move', 'down', 'up']),
    x: coordinate,
    y: coordinate,
    button: z.enum(['left', 'middle', 'right']).default('left'),
    revision,
  }),
  z.strictObject({
    kind: z.literal('wheel'),
    x: coordinate,
    y: coordinate,
    deltaX: z.number().finite().min(-2000).max(2000),
    deltaY: z.number().finite().min(-2000).max(2000),
    revision,
  }),
  z.strictObject({ kind: z.literal('text'), text: z.string().min(1).max(2048), revision }),
  z.strictObject({
    kind: z.literal('key'),
    key: z.enum([
      'Backspace',
      'Delete',
      'Tab',
      'Enter',
      'Escape',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'SelectAll',
    ]),
    shift: z.boolean().default(false),
    control: z.boolean().default(false),
    revision,
  }),
  z.strictObject({ kind: z.literal('release'), revision }),
]);
export const navigationActionSchema = z.enum(['back', 'forward', 'reload', 'home']);
const commandId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('auth'), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }),
  z.strictObject({ type: z.literal('visibility'), visible: z.boolean() }),
  z.strictObject({ type: z.literal('input'), id: commandId, input: inputSchema }),
  z.strictObject({ type: z.literal('resize'), id: commandId, viewport: viewportSchema }),
  z.strictObject({ type: z.literal('navigation'), id: commandId, action: navigationActionSchema }),
]);
export const serverMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready'), session: browserSessionSchema }),
  z.strictObject({ type: z.literal('status'), session: browserSessionSchema }),
  z.strictObject({ type: z.literal('ack'), id: commandId, session: browserSessionSchema }),
  z.strictObject({
    type: z.literal('error'),
    id: commandId.optional(),
    code: z.string(),
    message: z.string(),
  }),
]);
export const frameMetadataSchema = z.strictObject({
  sequence: commandId,
  revision,
  width: z.number().int().min(320).max(1920),
  height: z.number().int().min(240).max(1080),
});
export type BrowserInput = z.infer<typeof inputSchema>;
export type NavigationAction = z.infer<typeof navigationActionSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type FrameMetadata = z.infer<typeof frameMetadataSchema>;

/** Binary frame: 4-byte big-endian JSON length, UTF-8 metadata, then JPEG bytes. */
export function encodeFrame(metadata: FrameMetadata, jpeg: Uint8Array): Uint8Array {
  const header = new TextEncoder().encode(JSON.stringify(frameMetadataSchema.parse(metadata)));
  const result = new Uint8Array(4 + header.length + jpeg.length);
  new DataView(result.buffer).setUint32(0, header.length);
  result.set(header, 4);
  result.set(jpeg, 4 + header.length);
  return result;
}
export function decodeFrame(buffer: ArrayBuffer): { metadata: FrameMetadata; jpeg: Uint8Array } {
  if (buffer.byteLength < 8 || buffer.byteLength > 5 * 1024 * 1024)
    throw new Error('Invalid frame size.');
  const length = new DataView(buffer).getUint32(0);
  if (length > 1024 || length + 7 > buffer.byteLength) throw new Error('Invalid frame header.');
  const metadata = frameMetadataSchema.parse(
    JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, length))),
  );
  const jpeg = new Uint8Array(buffer, 4 + length);
  if (jpeg[0] !== 255 || jpeg[1] !== 216 || jpeg[2] !== 255) throw new Error('Invalid JPEG frame.');
  return { metadata, jpeg };
}
