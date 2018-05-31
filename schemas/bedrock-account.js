/*!
 * Copyright (c) 2018 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const bedrock = require('bedrock');

const schema = {
  required: true,
  title: 'User Account',
  type: 'object',
  properties: {
    id: {
      type: 'string',
      required: true
    },
    email: {
      type: 'string',
      required: true
    }
  },
  additionalProperties: true
};

module.exports = function(extend) {
  if(extend) {
    return bedrock.util.extend(true, bedrock.util.clone(schema), extend);
  }
  return schema;
};
