import { z } from 'zod';

const plate = z.string().regex(/^[A-Z]{1,2}\s?\d{1,4}\s?[A-Z]{0,3}$/i, 'invalid_plate');
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const uuid = z.string().uuid();

export const loginSchema = z.object({ phone: z.string().min(8).max(20), password: z.string().min(8).max(128) }).strict();
export const refreshSchema = z.object({ refreshToken: z.string().min(10), deviceId: z.string().min(1) }).strict();

export const checkInSchema = z.object({
  vehiclePlate: plate,
  vehicleType: z.enum(['MOTOR', 'CAR', 'TRUCK']),
  latitude: lat,
  longitude: lng,
}).strict();

export const checkoutSchema = z.object({ ticketId: uuid }).strict();

export const reportSchema = z.object({
  latitude: lat,
  longitude: lng,
  description: z.string().min(3).max(2000),
  photoObjectKey: uuid.optional(),
}).strict();

export type CheckInBody = z.infer<typeof checkInSchema>;
export type CheckoutBody = z.infer<typeof checkoutSchema>;
export type ReportBody = z.infer<typeof reportSchema>;
