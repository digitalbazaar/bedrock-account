/*!
 * Copyright (c) 2022-2023 Digital Bazaar, Inc. All rights reserved.
 */
import {logger} from './logger.js';

export class RecordTransactionProcessor {
  constructor({recordCollection} = {}) {
    this.recordCollection = recordCollection;
  }

  async commitTransaction({id, data, meta, expectedSequence, txn} = {}) {
    const {recordCollection: {helper}} = this;

    // write `committed` transaction to record and update any `data`/`meta`
    const newTxn = {...txn, committed: true};
    const update = {id, data, meta, expectedSequence, oldTxn: txn, newTxn};
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
      console.log('completing proxy ops');
      await this._completeProxyOperations({record, data, txn});
      console.log('proxy ops complete');

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
      console.log('++++++++++++PROCESS ANY PENDING TXN');
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
        const results = await Promise.allSettled(blockingProxyRecords.map(
          async ({proxyCollection, proxyRecord}) => {
            const {_txn: {id: txnId}, uniqueValue} = proxyRecord;
            // note that this only throws on unrecoverable errors
            console.log('--------------ROLLBACK CHANGE 2');
            return proxyCollection.rollbackChange(
              {txnId, oldValue: uniqueValue});
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
  async rollbackTransaction({record, data, txn, throwError = true} = {}) {
    // determine new/old data
    const {newData, oldData} = this._getNewAndOldData({record, data, txn});

    console.log('rolling back transaction', record, txn);
    console.log('rollback oldData', oldData);
    console.log('rollback newData', newData);

    const {recordCollection: {helper, dataField, proxyCollections}} = this;
    const {id} = record[dataField];
    try {
      // mark data record with transaction to be rolled back if not already so
      let newTxn = txn;
      if(!newTxn.rollback) {
        newTxn = {...txn, rollback: true};
        console.log('rollback, oldTxn', txn, 'newTxn', newTxn);
        // use internal helper update method as sequence is not to be changed
        if(!await helper._update({id, newTxn, oldTxn: txn})) {
          console.log('rollback aborted');
          // some other transaction is being applied / rolled back, abort
          this.throwAbortError();
        }
        console.log('rollback txn set in data record');
      }

      // roll back changes on all proxy collections
      const entries = [...proxyCollections.entries()];
      const {id: txnId} = newTxn;
      const results = await Promise.allSettled(entries.map(
        async ([k, proxyCollection]) => {
          const newValue = newData?.[k];
          const oldValue = oldData?.[k];
          console.log('--------------ROLLBACK CHANGE 1');
          return proxyCollection.rollbackChange({txnId, newValue, oldValue});
        }));
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
    const blockingProxyRecordsMap = new Map();

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
          const blocked = blockingProxyRecordsMap.get(txnRecordId);
          if(blocked) {
            blocked.push({proxyCollection, proxyRecord});
          } else {
            blockingProxyRecordsMap.set(
              txnRecordId, [{proxyCollection, proxyRecord}]);
          }
        }
      }));
      console.log('ops all settled');
      this._throwAnyRejection({results});

      // process all pending transactions to unblock ops
      const entries = [...blockingProxyRecordsMap.entries()];
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
    // determine new/old data
    const {newData, oldData} = this._getNewAndOldData({record, data, txn});

    // complete all proxy operations related to the transaction
    console.log('********COMPLETE PROXY OPs');
    console.log('old data', oldData);
    console.log('new data', newData);
    const {recordCollection: {proxyCollections}} = this;
    const entries = [...proxyCollections.entries()];
    const results = await Promise.allSettled(
      entries.map(async ([k, proxyCollection]) => {
        const newValue = newData?.[k];
        const oldValue = oldData?.[k];
        console.log('completing change', txn.id, {oldValue, newValue});
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
      } else if(txn.type !== 'update' && uniqueValue !== undefined) {
        ops.push({type: txn.type, proxyCollection, uniqueValue});
      }
    }
    return ops;
  }

  _getNewAndOldData({record, data, txn} = {}) {
    const {recordCollection: {dataField}} = this;

    // determine new/old data by parameters and transaction type
    let newData;
    let oldData;
    if(txn.type === 'update') {
      // for an update operation, the `newData` is either directly given via
      // `data` and the `record` has the old data, `data` is not given and the
      // `record` has the new data and there is no old data
      if(data !== undefined) {
        newData = data;
        oldData = record[dataField];
      } else {
        oldData = record[dataField];
      }
    } else if(txn.type === 'insert') {
      // no old data, only new
      newData = record[dataField];
    } else if(txn.type === 'delete') {
      // no new data, only old
      oldData = record[dataField];
    }
    return {newData, oldData};
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
              console.log('STABLE DUPLICATE FOUND', existing);
              throw e;
            }
            // got an abort error when trying to mark record for deletion; so
            // there was a concurrent update; loop to retry
            continue;
          }
          console.log('SHOULD BE RETURNING FOR PROCESSING');
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
