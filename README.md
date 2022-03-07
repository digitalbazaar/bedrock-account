# bedrock-account
User accounts for Bedrock Applications

## API Reference
<a name="module_bedrock-account"></a>

## bedrock-account

* [bedrock-account](#module_bedrock-account)
    * [.insert(options)](#module_bedrock-account.insert) ⇒ <code>Promise</code>
    * [.exists(options)](#module_bedrock-account.exists) ⇒ <code>Promise</code>
    * [.get(options)](#module_bedrock-account.get) ⇒ <code>Promise</code>
    * [.getAll(options)](#module_bedrock-account.getAll) ⇒ <code>Promise</code>
    * [.update(options)](#module_bedrock-account.update) ⇒ <code>Promise</code>
    * [.setStatus(options)](#module_bedrock-account.setStatus) ⇒ <code>Promise</code>

<a name="module_bedrock-account.insert"></a>

### bedrock-account.insert(options) ⇒ <code>Promise</code>
Inserts a new account. The account must contain `id`.

**Kind**: static method of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves to the database account record.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>object</code> | The options to use. |
| options.account | <code>object</code> | The account containing at least the   minimum required data. |
| [options.meta] | <code>object</code> | The meta information to include. |

<a name="module_bedrock-account.exists"></a>

### bedrock-account.exists(options) ⇒ <code>Promise</code>
Check for the existence of an account.

**Kind**: static method of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves to a boolean indicating account existence.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| options | <code>object</code> |  | The options to use. |
| [options.id] | <code>string</code> |  | The ID of the account to check. |
| [options.email] | <code>string</code> |  | The email address for the account. |
| [options.status] | <code>string</code> | <code>&quot;active&quot;</code> | The status to check for   (options: 'active', deleted'). |

<a name="module_bedrock-account.get"></a>

### bedrock-account.get(options) ⇒ <code>Promise</code>
Retrieves an account.

**Kind**: static method of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves to `{account, meta}`.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>object</code> | The options to use. |
| options.id | <code>string</code> | The ID of the account to retrieve. |

<a name="module_bedrock-account.getAll"></a>

### bedrock-account.getAll(options) ⇒ <code>Promise</code>
Retrieves all accounts matching the given query.

**Kind**: static method of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves to the records that matched the query.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| options | <code>object</code> |  | The options to use. |
| [options.query] | <code>object</code> | <code>{}</code> | The query to use. |
| [options.options] | <code>object</code> | <code>{}</code> | The options (eg: 'sort', 'limit'). |

<a name="module_bedrock-account.update"></a>

### bedrock-account.update(options) ⇒ <code>Promise</code>
Updates an account.

**Kind**: static method of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves once the operation completes.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>object</code> | The options to use. |
| options.id | <code>string</code> | The ID of the account to update. |
| options.patch | <code>Array</code> | A JSON patch for performing the update. |
| options.sequence | <code>number</code> | The sequence number that must match the   current record prior to the patch. |

<a name="module_bedrock-account.setStatus"></a>

### bedrock-account.setStatus(options) ⇒ <code>Promise</code>
Sets an account's status.

**Kind**: static method of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves once the operation completes.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>object</code> | The options to use. |
| options.id | <code>string</code> | The account ID. |
| options.status | <code>string</code> | The status. |

