/*
 * Copyright (c) 2018-2026 Digital Bazaar, Inc. All rights reserved.
 */
import {config} from '@bedrock/core';

config.account = {
  policyDefaults: {
    // set a default to store a snapshot on new accounts
    default: undefined,
    legacy: {
      // Unix timestamp in milliseconds. Undefined disables the cutoff.
      createdBefore: undefined,
      policy: {}
    }
  }
};
