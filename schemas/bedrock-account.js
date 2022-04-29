/*!
 * Copyright (c) 2018-2022 Digital Bazaar, Inc. All rights reserved.
 */
export const schema = {
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
