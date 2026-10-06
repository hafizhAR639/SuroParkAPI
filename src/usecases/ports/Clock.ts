/** Port owned by the use case layer (TRD §18.2). Injectable clock so time is mockable. */
export interface Clock {
  now(): Date;
}
