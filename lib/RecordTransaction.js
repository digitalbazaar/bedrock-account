/*!
 * Copyright (c) 2022-2023 Digital Bazaar, Inc. All rights reserved.
 */
import {v4 as uuid} from 'uuid';

export class RecordTransaction {
  constructor({
    type, id, record, data, meta, expectedSequence, recordCollection
  } = {}) {
    this.txn = {id: uuid(), type, recordId: id};
    this.id = id;
    this.record = record;
    this.data = data;
    this.meta = meta;
    this.expectedSequence = expectedSequence;
    this.recordCollection = recordCollection;
    this.initialize = this[`_init_${type}`];
  }

  async run() {
    const {
      id, record, data, meta, expectedSequence, txn,
      recordCollection: {transactionProcessor: tp}
    } = this;

    try {
      // init transaction (write intent to change data record)
      if(!await this.initialize()) {
        // try to complete any pending transaction
        const result = await tp.processAnyPendingTransaction({id});
        if(!result.processed && !result.record) {
          // record doesn't exist; never called in `insert` case, so safe to
          // to throw not found for both `update` and `delete` cases
          throw result.error;
        }
        // abort and retry
        tp.throwAbortError();
      }

      // perform relevant proxy collection updates
      await tp.updateProxyRecords({record, data, txn});

      // commit transaction (write to data record w/actual changes)
      await tp.commitTransaction(
        {id, record, data, meta, expectedSequence, txn});

      // transaction committed, now complete it in the background
      await tp.completeTransaction({record, data, txn, throwError: false});
    } catch(e) {
      // roll transaction back, but do not throw any errors
      await tp.rollbackTransaction({id, record, data, txn, throwError: false});

      // transaction aborted, loop to retry
      if(e.name === 'AbortError') {
        throw e;
      }

      // duplicate error only occurs during an `insert` transaction
      if(e.name === 'DuplicateError') {
        // try to process a pending transaction on the duplicate record
        let recordId;
        try {
          recordId = await this._getDuplicateRecordId({error: e});
        } catch(e) {
          if(e.name !== 'NotFoundError') {
            // unrecoverable error
            throw e;
          }
          // proxy record now removed, transaction aborted
          tp.throwAbortError();
        }

        const result = await tp.processAnyPendingTransaction({id: recordId});
        if(!result.processed) {
          if(result.record) {
            // record is a stable duplicate, throw
            throw e;
          }
          // record has been deleted, transaction aborted
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
    return true;
  }

  async _init_update() {
    // mark data record for update
    const {id, data, meta, txn, recordCollection: {helper}} = this;
    // need to check expected sequence without setting `data` or `meta`
    let {expectedSequence} = this;
    const result = helper.validateUpdateParams(
      {id, data, meta, expectedSequence});
    ({expectedSequence} = result);
    const {sequenceLocation} = result;
    return helper._update(
      {id, expectedSequence, sequenceLocation, newTxn: txn});
  }

  async _init_delete() {
    // mark data record for removal
    const {id, txn, recordCollection: {helper}} = this;
    return helper.update({id, newTxn: txn});
  }

  async _getDuplicateRecordId({error} = {}) {
    const {uniqueField, uniqueValue} = error.details;
    if(uniqueField === 'id') {
      return error.details.recordId;
    }
    const {recordCollection: {proxyCollections, dataField}} = this;
    const proxyCollection = proxyCollections.get(uniqueField);
    const duplicate = await proxyCollection.get({uniqueValue});
    const idField = `${dataField}Id`;
    return duplicate[idField];
  }
}
