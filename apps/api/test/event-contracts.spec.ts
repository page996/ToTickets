import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EventBusService } from '../src/common/events/event-bus.service';
import { ClockService } from '../src/common/time/clock.service';
import { loadRuntimeConfig } from '../src/config/runtime-config';
import { installIsolatedTestEnvironment } from './test-environment';

interface SchemaProperty {
  type?: 'string' | 'integer' | 'boolean' | 'object';
  const?: unknown;
  enum?: unknown[];
  format?: 'uuid' | 'date-time' | 'uri';
  minLength?: number;
  minimum?: number;
  maximum?: number;
}

interface ObjectSchema {
  $id: string;
  type: 'object';
  additionalProperties: false;
  required: string[];
  properties: Record<string, SchemaProperty>;
}

const DEVICE_ID = '00000000-0000-4000-8000-000000000001';
const SCHEDULE_ID = '00000000-0000-4000-8000-000000000002';
const SCHEMA_DIRECTORY = resolve(__dirname, '../../../docs/schemas');

const EVENT_FIXTURES: Array<{
  type: string;
  subject: string;
  data: Record<string, unknown>;
}> = [
  {
    type: 'device.health.changed',
    subject: `device/${DEVICE_ID}`,
    data: {
      device_id: DEVICE_ID,
      state: 'ready',
      heartbeat_age_ms: 0,
      stream: 'stopped',
      device_sequence: 2,
    },
  },
  {
    type: 'screen.stream.started',
    subject: `device/${DEVICE_ID}`,
    data: { device_id: DEVICE_ID, stream: 'running', device_sequence: 3 },
  },
  {
    type: 'screen.stream.stopped',
    subject: `device/${DEVICE_ID}`,
    data: { device_id: DEVICE_ID, stream: 'stopped', device_sequence: 4 },
  },
  {
    type: 'device.focus.changed',
    subject: `device/${DEVICE_ID}`,
    data: { device_id: DEVICE_ID, focused: true, device_sequence: 5 },
  },
  {
    type: 'schedule.created',
    subject: `schedule/${SCHEDULE_ID}`,
    data: {
      schedule_id: SCHEDULE_ID,
      state: 'scheduled',
      starts_at: '2030-01-01T00:01:00.000Z',
    },
  },
  {
    type: 'schedule.updated',
    subject: `schedule/${SCHEDULE_ID}`,
    data: { schedule_id: SCHEDULE_ID, state: 'cancelled' },
  },
  {
    type: 'reminder.acknowledged',
    subject: `schedule/${SCHEDULE_ID}`,
    data: { schedule_id: SCHEDULE_ID, state: 'human_confirmed' },
  },
  {
    type: 'clock.uncertain',
    subject: `schedule/${SCHEDULE_ID}`,
    data: { schedule_id: SCHEDULE_ID, offset_ms: -1000 },
  },
  {
    type: 'reminder.fired',
    subject: `schedule/${SCHEDULE_ID}`,
    data: { schedule_id: SCHEDULE_ID, channel: 'desktop', state: 'notified' },
  },
  {
    type: 'reminder.dispatch.failed',
    subject: `schedule/${SCHEDULE_ID}`,
    data: { schedule_id: SCHEDULE_ID, reminder_index: 0 },
  },
];

describe('versioned event contracts', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    installIsolatedTestEnvironment();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it.each(EVENT_FIXTURES)('matches the strict schema for $type', ({ type, subject, data }) => {
    const config = loadRuntimeConfig();
    const event = new EventBusService(config, new ClockService(config)).publish(
      type,
      data,
      subject,
    );
    const payloadSchema = readSchema(schemaFileName(type));
    const envelopeSchema = readSchema('cloud-event-envelope.v1.json');

    expect(event.schema).toBe(payloadSchema.$id);
    expectObjectToMatchSchema(event as unknown as Record<string, unknown>, envelopeSchema);
    expectObjectToMatchSchema(event.data, payloadSchema);
  });

  it('keeps every published payload schema strict and versioned', () => {
    for (const fixture of EVENT_FIXTURES) {
      const fileName = schemaFileName(fixture.type);
      const schema = readSchema(fileName);
      expect(schema.$id).toBe(`https://example.invalid/schemas/${fileName}`);
      expect(schema.type).toBe('object');
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(Object.keys(schema.properties));
    }
  });
});

function schemaFileName(type: string): string {
  return `${type.replace(/[^a-zA-Z0-9]+/g, '-')}.v1.json`;
}

function readSchema(fileName: string): ObjectSchema {
  return JSON.parse(readFileSync(resolve(SCHEMA_DIRECTORY, fileName), 'utf8')) as ObjectSchema;
}

function expectObjectToMatchSchema(
  value: Record<string, unknown>,
  schema: ObjectSchema,
): void {
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  for (const required of schema.required) expect(value).toHaveProperty(required);
  expect(Object.keys(value).filter((key) => !(key in schema.properties))).toEqual([]);

  for (const [key, property] of Object.entries(schema.properties)) {
    if (!(key in value)) continue;
    const candidate = value[key];
    if ('const' in property) expect(candidate).toEqual(property.const);
    if (property.enum) expect(property.enum).toContain(candidate);
    if (property.type === 'integer') expect(Number.isInteger(candidate)).toBe(true);
    if (property.type === 'string') expect(typeof candidate).toBe('string');
    if (property.type === 'boolean') expect(typeof candidate).toBe('boolean');
    if (property.type === 'object') {
      expect(typeof candidate).toBe('object');
      expect(candidate).not.toBeNull();
      expect(Array.isArray(candidate)).toBe(false);
    }
    if (property.minLength !== undefined) {
      expect((candidate as string).length).toBeGreaterThanOrEqual(property.minLength);
    }
    if (property.minimum !== undefined) {
      expect(candidate as number).toBeGreaterThanOrEqual(property.minimum);
    }
    if (property.maximum !== undefined) {
      expect(candidate as number).toBeLessThanOrEqual(property.maximum);
    }
    if (property.format === 'uuid') {
      expect(candidate).toEqual(
        expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
      );
    }
    if (property.format === 'date-time') {
      expect(Number.isFinite(Date.parse(candidate as string))).toBe(true);
      expect(candidate).toEqual(expect.stringMatching(/(?:Z|[+-]\d{2}:\d{2})$/i));
    }
    if (property.format === 'uri') {
      expect(() => new URL(candidate as string)).not.toThrow();
    }
  }
}
