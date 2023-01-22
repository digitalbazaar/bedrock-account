/*!
 * Copyright (c) 2022-2023 Digital Bazaar, Inc. All rights reserved.
 */
import {logger} from './logger.js';

export class RecordTransactionProcessor {
  constructor({recordCollection} = {}) {
    this.recordCollection = recordCollection;
  }

  async commitTransaction({id, data, meta, txn} = {}) {
    const {recordCollection: {helper}} = this;

    // write `committed` transaction to record and update any `data`/`meta`
    const newTxn = {...txn, committed: true};
    const update = {id, data, meta, oldTxn: txn, newTxn};
    if(txn.type === 'update') {
      // run full update
      if(!await helper.update(update)) {
        // commit failed; throw abort error
        this.throwAbortError();
      }
    } else {
      // run internal helper update w/o validation as `data` and `meta` will
      // not be passed
      update._pending = txn.type === 'delete' ? true : false;
      if(!await helper._update(update)) {
        // commit failed; throw abort error
        this.throwAbortError();
      }
    }
  }

  async completeTransaction({record, data, txn, throwError = true} = {}) {
    const {recordCollection: {dataField, helper}} = this;
    const {id} = record[dataField];
    txn = {...txn, committed: true};
    try {
      // complete any proxy operations
      await this._completeProxyOperations({record, data, txn});

      if(txn.type === 'delete') {
        // finally delete data record
        await helper.delete({id, txn});
      } else {
        // remove `txn` from record (use internal update helper to avoid
        // requiring `data` or `meta` changes)
        console.log('doing update', {id, oldTxn: txn});
        await helper._update({id, oldTxn: txn});
      }
    } catch(error) {
      if(throwError) {
        throw error;
      }
      logger.debug(
        `Failed to complete record "${id}" transaction "${txn.id}". It ` +
        'will be automatically completed on the next operation.', {error});
    }
  }

  // refreshes a record by processing any pending transaction; can throw
  // an abort error if the transaction processing aborts
  async processAnyPendingTransaction({id, blockingProxyRecords} = {}) {
    const {recordCollection: {helper}} = this;

    // get the existing record and process any pending transaction
    try {
      const record = await helper.get({id, _allowPending: true});
      if(!record._txn) {
        // nothing to process
        return {processed: false, record};
      }
      // process pending transaction
      await this.processPendingTransaction({record});
      return {processed: true};
    } catch(error) {
      if(error.name !== 'NotFoundError') {
        // unrecoverable error
        throw error;
      }
      /* Note: Here the data record does not exist, but it is safe to
      rollback any proxy record changes. The only way this state can
      occur is if a process running a transaction stalled, the
      transaction was rolled back by another process, and then the
      stalled process continued and wrote some proxy records that will
      never be committed and might not be deleted if that previously
      stalled process crashes prior to removing them. */
      if(blockingProxyRecords) {
        // FIXME: test unrecoverable error thrown from
        // proxyCollection.rollbackChange()
        const results = await Promise.allSettled(blockingProxyRecords.map(
          async ({proxyCollection, proxyRecord}) => {
            const {_txn: {id: txnId}, uniqueValue} = proxyRecord;
            // note that this only throws on unrecoverable errors
            return proxyCollection.rollbackChange({txnId, uniqueValue});
          }));
        this._throwAnyRejection({results});
      }
      return {processed: false, record: null, error};
    }
  }

  async processPendingTransaction({record, throwError = true} = {}) {
    // complete or rollback existing transaction
    const {_txn: txn} = record;
    const promise = txn.committed ?
      this.completeTransaction({record, txn, throwError}) :
      this.rollbackTransaction({record, txn, throwError});
    if(throwError) {
      await promise;
    }
    // background process and do not throw error; any error will be logged
    // within the above functions
    promise.catch(() => {});
  }

  // FIXME: check implementation
  async rollbackTransaction({record, txn, throwError = true} = {}) {
    console.log('rolling back transaction', record, txn);
    const {recordCollection: {helper, dataField, proxyCollections}} = this;
    const {id} = record[dataField];

    try {
      // mark data record with transaction to be rolled back if not already so
      let newTxn = txn;
      if(!newTxn.rollback) {
        newTxn = {...txn, rollback: true};
        console.log('rollback, oldTxn', txn, 'newTxn', newTxn);
        // use internal helper update method as `data` and `meta` are not to
        // be changed
        if(!await helper._update({id, newTxn, oldTxn: txn})) {
          console.log('rollback aborted');
          // some other transaction is being applied / rolled back, abort
          this.throwAbortError();
        }
        console.log('rollback txn set in data record');
      }

      // roll back changes on all proxy collections
      const values = [...proxyCollections.values()];
      // FIXME: determine if `uniqueValue` can be passed here
      const {id: txnId} = newTxn;
      const results = await Promise.allSettled(values.map(
        async proxyCollection => proxyCollection.rollbackChange({txnId})));
      this._throwAnyRejection({results});

      // if transaction was an insert, now safe to delete the data record
      if(newTxn.type === 'insert') {
        console.log('deleting rolled back insert');
        if(!await helper.delete({id, txn: newTxn})) {
          console.log('rolled back insert deletion failed');
          // some other transaction is being applied / rolled back, abort
          this.throwAbortError();
        }
      } else {
        console.log('updating rolled back txn', newTxn.type);
        // clear transaction from record; use internal helper method since
        // `data` and `meta` will be unchanged
        if(!await helper._update({id, oldTxn: newTxn})) {
          // some other transaction is being applied / rolled back, abort
          this.throwAbortError();
        }
      }
    } catch(error) {
      if(throwError) {
        throw error;
      }
      logger.debug(
        `Failed to rollback transaction "${txn.id}" for record "${id}". It ` +
        'will be automatically handled on the next read or write.', {error});
    }
  }

  async updateProxyRecords({record, data, txn} = {}) {
    // determine proxy operations to be run
    let ops = this._createPrepareProxyOperations({record, data, txn});

    // used to track proxy records that are blocking proxy operations; these
    // are tracked by the record ID associated with their pending transactions
    const blockingProxyRecords = new Map();

    // keep attempting to run all proxy operations until all have been
    // completed or rollback for `record` is required
    const {recordCollection: {dataField}} = this;
    console.log('record', record);
    const recordId = record[dataField].id;
    while(ops.length > 0) {
      console.log('processing ops', ops.length);
      const tmp = ops;
      ops = [];
      // wait for all proxy operations to settle
      let results = await Promise.allSettled(tmp.map(async op => {
        const result = await this._runProxyOperation({recordId, txn, op});
        if(!result.success) {
          console.log('op blocked', op);
          ops.push(op);
          const {proxyRecord} = result;
          // the record ID in the txn may be different from `recordId`
          const {recordId: txnRecordId} = proxyRecord._txn;
          const {proxyCollection} = op;
          const blocked = blockingProxyRecords.get(txnRecordId);
          if(blocked) {
            blocked.push({proxyCollection, proxyRecord});
          } else {
            blockingProxyRecords.set(
              txnRecordId, {proxyCollection, proxyRecord});
          }
        }
      }));
      console.log('ops all settled');
      this._throwAnyRejection({results});

      // process all pending transactions to unblock ops
      const entries = [...blockingProxyRecords.entries()];
      console.log('handling blocking proxy records');
      results = await Promise.allSettled(
        entries.map(async ([id, blockingProxyRecords]) => {
          try {
            await this.processAnyPendingTransaction({id, blockingProxyRecords});
          } catch(e) {
            if(e.name !== 'AbortError') {
              // unrecoverable error
              throw e;
            }
          }
        }));
      console.log('blocking proxy records all settled');
      this._throwAnyRejection({results});
    }
  }

  throwAbortError() {
    const error = new Error('Transaction operation aborted.');
    error.name = 'AbortError';
    throw error;
  }

  async _completeProxyOperations({record, data, txn} = {}) {
    // determine proxy operations to be run in a transaction
    const {recordCollection: {dataField, proxyCollections}} = this;
    const entries = [...proxyCollections.entries()];
    const results = await Promise.allSettled(
      entries.map(async ([k, proxyCollection]) => {
        // FIXME: ensure that these are correct
        const newValue = data ? data[k] : record[dataField][k];
        const oldValue = record[dataField][k];
        await proxyCollection.completeChange(
          {txnId: txn.id, oldValue, newValue});
      }));
    this._throwAnyRejection({results});
  }

  _createPrepareProxyOperations({record, data, txn} = {}) {
    // determine proxy operations to be run in a transaction
    const ops = [];
    const {recordCollection: {dataField, proxyCollections}} = this;
    const recordData = record[dataField];
    for(const [k, proxyCollection] of proxyCollections) {
      const uniqueValue = recordData[k];
      if(data) {
        const newValue = data[k];
        if(uniqueValue === newValue) {
          // nothing to change
          continue;
        }
        // push op to delete old value and to insert new one
        ops.push({type: 'delete', proxyCollection, uniqueValue});
        ops.push({type: 'insert', proxyCollection, uniqueValue: newValue});
      } else if(uniqueValue !== undefined) {
        ops.push({type: txn.type, proxyCollection, uniqueValue});
      }
    }
    return ops;
  }

  async _runProxyOperation({recordId, txn, op} = {}) {
    // keep trying to run op, handling any concurrent changes to the proxy
    // record based on the type of op, until the op completes or throws
    const {type, proxyCollection, uniqueValue} = op;
    // FIXME: place a limit on attempts?
    while(true) {
      console.log('running proxy op', op);
      try {
        if(type === 'insert') {
          await proxyCollection.insert({uniqueValue, recordId, txn});
        } else {
          // can assume `type` is `delete` and this should perform an update to
          // mark the proxy record to be deleted, not actually delete it
          if(!await proxyCollection.prepareDelete({recordId, txn})) {
            this.throwAbortError();
          }
        }
        // successful op
        return {success: true};
      } catch(e) {
        console.log('error during proxy op', e);
        const aborted = e.name === 'AbortError';
        const duplicate = e.name === 'DuplicateError';
        if(!(aborted || duplicate)) {
          // FIXME: ensure to test simulated unrecoverable error
          // error is unrecoverable; throw it
          throw e;
        }
        try {
          // check existing proxy record based on `uniqueValue` (do not include
          // `recordId` as it may be different) for a pending transaction to be
          // processed
          const existing = await proxyCollection.get({uniqueValue});
          console.log('existing proxy record found', existing);
          if(!existing._txn) {
            if(duplicate) {
              // stable duplicate found, throw error
              throw e;
            }
            // got an abort error when trying to mark record for deletion; so
            // there was a concurrent update; loop to retry
            continue;
          }
          // pending transaction found, return existing record for processing
          return {success: false, proxyRecord: existing};
        } catch(e) {
          console.log('error trying to fetch existing proxy record', e);
          if(e.name === 'NotFoundError' && duplicate) {
            // duplicate proxy record now deleted, loop to try insert again
            continue;
          }
          throw e;
        }
      }
    }
  }

  _throwAnyRejection({results} = {}) {
    // throw any error that occurred
    const rejected = results.find(({status}) => status === 'rejected');
    if(rejected) {
      throw rejected.reason;
    }
  }
}
