/*!
 * Copyright (c) 2022-2023 Digital Bazaar, Inc. All rights reserved.
 */
import {v4 as uuid} from 'uuid';

export class RecordTransaction {
  constuctor({type, id, record, data, meta, recordCollection} = {}) {
    this.txn = {id: uuid(), type, recordId: id};
    this.id = id;
    this.record = record;
    this.data = data;
    this.meta = meta;
    this.recordCollection = recordCollection;
    this.initialize = this[`_init_${type}`];
  }

  async run() {
    const {id, recordCollection: {transactionProcessor: tp}} = this;

    try {
      // init transaction (write intent to change data record)
      if(!await this.initialize()) {
        // try to complete any pending transaction
        const result = await tp.processAnyPendingTransaction(
          {id});
        if(!result.processed && !result.record) {
          // record doesn't exist; never called in `insert` case, so safe to
          // to throw not found for both `update` and `delete` cases
          throw result.error;
        }
        // abort and retry
        tp.throwAbortError();
      }

      // perform relevant proxy collection updates
      await tp.updateProxyRecords();

      // commit transaction (write to data record w/actual changes)
      const {record, data, meta, txn} = this;
      const newTxn = {...txn, committed: true};
      const update = {id, data, meta, oldTxn: txn, newTxn};
      if(txn.type === 'delete') {
        update._pending = true;
      } else if(txn.type === 'insert') {
        update._pending = false;
      }
      await tp.commitTransaction({id, record, txn, update});

      // transaction committed, now complete it in the background
      await tp.completeTransaction({record, data, txn, throwError: false});
    } catch(e) {
      // roll transaction back; but do not throw any errors
      const {id, txn} = this;
      await tp.rollbackTransaction({id, txn, throwError: false});

      // transaction aborted, loop to retry
      if(e.name === 'AbortError') {
        throw e;
      }

      // duplicate error only occurs during an `insert` transaction
      if(e.name === 'DuplicateError') {
        // try to process a pending transaction
        const result = await tp.processAnyPendingTransaction({id});
        if(!result.processed) {
          if(result.record) {
            // record is a stable duplicate, throw
            throw e;
          }
          // record has been removed, transaction aborted
          tp.throwAbortError();
        }
      }

      // throw any other error (unrecoverable)
      throw e;
    }
  }

  async _init_insert() {
    // insert pending record; it must be present prior to the
    // insertion of any proxy records tagged with the `txn` in
    // order to enable clean transaction rollback or commitment
    const {txn, recordCollection: {helper}} = this;
    const record = {...this.record, _pending: true, _txn: txn};
    // if this throws a duplicate error, it will be handled via `run()`
    await helper.insert({record});
  }

  async _init_update() {
    // mark data record for update
    const {id, data, meta, txn, recordCollection: {helper}} = this;
    // need to check expected sequence without setting `data` or `meta`
    const {
      expectedSequence, sequenceLocation
    } = helper.validateParams({id, data, meta});
    return helper._update(
      {id, expectedSequence, sequenceLocation, newTxn: txn});
  }

  async _init_delete() {
    // mark data record for removal
    const {id, txn, recordCollection: {helper}} = this;
    return helper.update({id, newTxn: txn});
  }
}
