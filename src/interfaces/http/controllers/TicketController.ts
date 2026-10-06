import type { Request, Response } from 'express';
import type { IssueTicketUseCase } from '../../../usecases/ticket/IssueTicketUseCase.js';
import type { CheckoutTicketUseCase } from '../../../usecases/ticket/CheckoutTicketUseCase.js';
import type { AuditLogService } from '../../../infrastructure/audit/AuditLogService.js';
import type { Actor, UserRole } from '../../../domain/entities/Actor.js';
import { asyncHandler } from '../middlewares/errorHandler.js';

function requireActor(req: Request): Actor {
  const actor = req.actor;
  if (actor === undefined) {
    throw Object.assign(new Error('unauthenticated'), { status: 401 });
  }
  return actor;
}

export function TicketController(
  issue: IssueTicketUseCase,
  checkout: CheckoutTicketUseCase,
  audit: AuditLogService,
) {
  return {
    checkIn: asyncHandler(async (req: Request, res: Response) => {
      const actor = requireActor(req);
      const body = req.body as {
        vehiclePlate: string;
        vehicleType: 'MOTOR' | 'CAR' | 'TRUCK';
        latitude: number;
        longitude: number;
      };
      const ownerUserId = actor.role === ('USER' as UserRole) ? actor.id : null;
      const ticket = await issue.execute({
        actor,
        vehiclePlate: body.vehiclePlate,
        vehicleType: body.vehicleType,
        latitude: body.latitude,
        longitude: body.longitude,
        ownerUserId,
      });
      await audit.log({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'TICKET_ISSUED',
        entity: 'TICKET',
        entityId: ticket.props.id,
        after: { zoneId: ticket.props.zoneId, vehicleType: ticket.props.vehicleType },
        ip: req.ip,
        deviceId: req.header('x-device-id'),
      });
      res.status(201).json({
        ticketId: ticket.props.id,
        ticketCode: ticket.props.ticketCode,
        zoneId: ticket.props.zoneId,
        status: ticket.status,
        checkInAt: ticket.props.checkInAt,
      });
    }),

    checkOut: asyncHandler(async (req: Request, res: Response) => {
      const actor = requireActor(req);
      const { ticketId } = req.body as { ticketId: string };
      const { ticket, qris } = await checkout.execute({ actor, ticketId });
      res.json({
        ticketId: ticket.props.id,
        totalFee: ticket.props.totalFee?.rupiah.toString() ?? null,
        qrString: qris.qrString,
        expiresAt: qris.expiresAt,
      });
    }),
  };
}
