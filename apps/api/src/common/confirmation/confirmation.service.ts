import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import {
  ApiError,
  CommandExpiredError,
  CommandStaleError,
  ConfirmationRequiredError,
  PolicyDeniedError,
} from '../errors/api-error';
import { RUNTIME_CONFIG, RuntimeConfig } from '../../config/runtime-config';
import { ClockService } from '../time/clock.service';

export const SAFE_CONFIRMATION_INTENTS = [
  'device.start',
  'device.stop',
  'device.reconnect',
  'preview.start',
  'preview.stop',
  'device.focus',
  'safety.stop-all',
] as const;

export type SafeConfirmationIntent = (typeof SAFE_CONFIRMATION_INTENTS)[number];

interface ConfirmationTicket {
  id: string;
  operatorId: string;
  deviceId?: string;
  expectedSequence?: number;
  intent: SafeConfirmationIntent;
  expiresAt: number;
  reserved: boolean;
}

export interface ConfirmationReservation {
  commit(): void;
  release(): void;
}

export interface ConfirmationStats {
  tickets: number;
  capacity: number;
}

@Injectable()
export class ConfirmationService {
  private readonly tickets = new Map<string, ConfirmationTicket>();
  constructor(
    private readonly audit: AuditService,
    @Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig,
    private readonly clock: ClockService,
  ) {}

  issue(input: {
    operatorId: string;
    intent: string;
    deviceId?: string;
    expectedSequence?: number;
    currentDeviceSequence?: number;
    confirmed: boolean;
  }): {
    confirmation_id: string;
    intent: SafeConfirmationIntent;
    expires_at: string;
    expected_sequence?: number;
  } {
    this.prune();
    if (input.confirmed !== true) throw new ConfirmationRequiredError();
    if (!SAFE_CONFIRMATION_INTENTS.includes(input.intent as SafeConfirmationIntent)) {
      throw new PolicyDeniedError('the requested intent cannot receive a confirmation ticket');
    }
    const deviceScoped = input.intent !== 'safety.stop-all';
    if (deviceScoped !== Boolean(input.deviceId)) {
      throw new ApiError(
        'schema.invalid',
        deviceScoped
          ? 'device_id is required for this confirmation intent'
          : 'device_id is not accepted for safety.stop-all',
        422,
      );
    }
    if (!deviceScoped && (input.expectedSequence !== undefined || input.currentDeviceSequence !== undefined)) {
      throw new ApiError('schema.invalid', 'expected_sequence is not accepted for safety.stop-all', 422);
    }
    if (
      deviceScoped &&
      (input.expectedSequence === undefined || input.currentDeviceSequence === undefined)
    ) {
      throw new ApiError(
        'schema.invalid',
        'expected_sequence is required for device confirmation intents',
        422,
      );
    }
    if (deviceScoped && input.expectedSequence !== input.currentDeviceSequence) {
      throw new CommandStaleError();
    }
    if (this.tickets.size >= this.config.policy.confirmationMaxEntries) {
      throw new ApiError('device.busy', 'confirmation ticket capacity has been reached', 503, true);
    }
    const ticket: ConfirmationTicket = {
      id: randomUUID(),
      operatorId: input.operatorId,
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
      ...(input.expectedSequence !== undefined
        ? { expectedSequence: input.expectedSequence }
        : {}),
      intent: input.intent as SafeConfirmationIntent,
      expiresAt: this.clock.nowEpochMs() + this.config.policy.confirmationTtlSeconds * 1000,
      reserved: false,
    };
    this.tickets.set(ticket.id, ticket);
    this.audit.append({ type: 'operator.confirmation.issued', operatorId: ticket.operatorId, deviceId: ticket.deviceId, result: 'accepted', metadata: { source: 'console-ui', operator_confirmed: true } });
    return {
      confirmation_id: ticket.id,
      intent: ticket.intent,
      expires_at: new Date(ticket.expiresAt).toISOString(),
      ...(ticket.expectedSequence !== undefined
        ? { expected_sequence: ticket.expectedSequence }
        : {}),
    };
  }

  consume(input: {
    confirmationId?: string;
    operatorId?: string;
    intent: string;
    deviceId?: string;
    expectedSequence?: number;
    currentDeviceSequence?: number;
  }): void {
    this.reserve(input).commit();
  }

  reserve(input: {
    confirmationId?: string;
    operatorId?: string;
    intent: string;
    deviceId?: string;
    expectedSequence?: number;
    currentDeviceSequence?: number;
  }): ConfirmationReservation {
    if (!input.confirmationId || !input.operatorId) throw new ConfirmationRequiredError();
    const ticket = this.tickets.get(input.confirmationId);
    if (!ticket || ticket.reserved) throw new ConfirmationRequiredError('the confirmation ticket is missing or already in use');
    if (ticket.expiresAt <= this.clock.nowEpochMs()) {
      this.tickets.delete(ticket.id);
      throw new CommandExpiredError();
    }
    if (
      ticket.operatorId !== input.operatorId ||
      ticket.intent !== input.intent ||
      ticket.deviceId !== input.deviceId
    ) {
      throw new PolicyDeniedError('confirmation ticket does not match this command');
    }
    const deviceScoped = ticket.intent !== 'safety.stop-all';
    if (!deviceScoped && (input.expectedSequence !== undefined || input.currentDeviceSequence !== undefined)) {
      throw new ApiError('schema.invalid', 'expected_sequence is not accepted for safety.stop-all', 422);
    }
    if (
      deviceScoped &&
      (
        ticket.expectedSequence === undefined ||
        input.expectedSequence === undefined ||
        input.currentDeviceSequence === undefined ||
        ticket.expectedSequence !== input.expectedSequence ||
        input.expectedSequence !== input.currentDeviceSequence
      )
    ) {
      this.tickets.delete(ticket.id);
      throw new CommandStaleError();
    }
    ticket.reserved = true;
    let settled = false;
    return {
      commit: () => {
        if (settled) return;
        settled = true;
        if (this.tickets.get(ticket.id) === ticket) this.tickets.delete(ticket.id);
      },
      release: () => {
        if (settled) return;
        settled = true;
        if (this.tickets.get(ticket.id) === ticket) ticket.reserved = false;
      },
    };
  }

  getStats(): ConfirmationStats {
    this.prune();
    return { tickets: this.tickets.size, capacity: this.config.policy.confirmationMaxEntries };
  }

  private prune(): void {
    const now = this.clock.nowEpochMs();
    for (const [id, ticket] of this.tickets) {
      if (ticket.expiresAt <= now && !ticket.reserved) this.tickets.delete(id);
    }
  }
}
