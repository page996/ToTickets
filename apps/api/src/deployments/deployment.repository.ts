import { Injectable } from '@nestjs/common';
import {
  DeploymentOperationRecord,
  DeploymentRecord,
} from './deployment.types';

/**
 * Process-local repository for the simulation boundary.  The public methods
 * return structured clones so callers cannot mutate state outside a service
 * operation.  SQLite can replace this class later without changing the
 * deployment service contract.
 */
@Injectable()
export class DeploymentRepository {
  private readonly records = new Map<string, DeploymentRecord>();
  private readonly operations = new Map<string, DeploymentOperationRecord>();
  private operationEvictions = 0;

  list(): DeploymentRecord[] {
    return [...this.records.values()].map(cloneRecord);
  }

  get(id: string): DeploymentRecord | undefined {
    const record = this.records.get(id);
    return record ? cloneRecord(record) : undefined;
  }

  create(record: DeploymentRecord, maximumRecords = Number.MAX_SAFE_INTEGER): DeploymentRecord | undefined {
    if (this.records.size >= maximumRecords) return undefined;
    if (this.records.has(record.id)) throw new Error('deployment record already exists');
    const stored = cloneRecord(record);
    this.records.set(stored.id, stored);
    return cloneRecord(stored);
  }

  update(
    id: string,
    change: (record: DeploymentRecord) => void,
  ): DeploymentRecord | undefined {
    const current = this.records.get(id);
    if (!current) return undefined;
    const changed = cloneRecord(current);
    change(changed);
    if (changed.id !== id) throw new Error('deployment record id cannot change');
    const stored = cloneRecord(changed);
    this.records.set(id, stored);
    return cloneRecord(stored);
  }

  getOperation(operationId: string): DeploymentOperationRecord | undefined {
    const operation = this.operations.get(operationId);
    return operation ? cloneOperation(operation) : undefined;
  }

  saveOperation(
    operation: DeploymentOperationRecord,
    maximumOperations = Number.MAX_SAFE_INTEGER,
  ): void {
    if (!Number.isSafeInteger(maximumOperations) || maximumOperations < 1) {
      throw new Error('maximum deployment operations must be a positive safe integer');
    }
    const existing = this.operations.get(operation.operationId);
    if (existing && existing.fingerprint !== operation.fingerprint) {
      throw new Error('deployment operation id already belongs to another operation');
    }
    if (!existing && this.operations.size >= maximumOperations) {
      const oldestOperationId = this.operations.keys().next().value as string | undefined;
      if (oldestOperationId !== undefined) {
        this.operations.delete(oldestOperationId);
        this.operationEvictions += 1;
      }
    }
    this.operations.set(operation.operationId, cloneOperation(operation));
  }

  size(): number {
    return this.records.size;
  }

  operationSize(): number {
    return this.operations.size;
  }

  getOperationStats(): { retained: number; capacityEvictions: number } {
    return {
      retained: this.operations.size,
      capacityEvictions: this.operationEvictions,
    };
  }
}

function cloneRecord(record: DeploymentRecord): DeploymentRecord {
  return structuredClone(record);
}

function cloneOperation(operation: DeploymentOperationRecord): DeploymentOperationRecord {
  return structuredClone(operation);
}
