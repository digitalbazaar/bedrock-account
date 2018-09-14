/*!
 * Copyright (c) 2018 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const bedrock = require('bedrock');

const schema = {
  title: 'User Account',
  required: [
    'email',
    'id',
  ],
  type: 'object',
  properties: {
    id: {
      type: 'string',
    },
    email: {
      type: 'string',
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
