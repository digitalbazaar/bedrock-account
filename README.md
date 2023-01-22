# bedrock-account
User accounts for Bedrock Applications

## API Reference
## Modules

<dl>
<dt><a href="#module_bedrock-account">bedrock-account</a></dt>
<dd></dd>
</dl>

## Typedefs

<dl>
<dt><a href="#ExplainObject">ExplainObject</a> : <code>object</code></dt>
<dd><p>An object containing information on the query plan.</p>
</dd>
<dt><a href="#ExplainObject">ExplainObject</a> : <code>object</code></dt>
<dd><p>An object containing information on the query plan.</p>
</dd>
<dt><a href="#ExplainObject">ExplainObject</a> : <code>object</code></dt>
<dd><p>An object containing information on the query plan.</p>
</dd>
</dl>

<a name="module_bedrock-account"></a>

## bedrock-account

* [bedrock-account](#module_bedrock-account)
    * [.insert(options)](#module_bedrock-account.insert) ⇒ <code>Promise</code>
    * [.exists(options)](#module_bedrock-account.exists) ⇒ <code>Promise</code>
    * [.get(options)](#module_bedrock-account.get) ⇒ <code>Promise</code> \| [<code>ExplainObject</code>](#ExplainObject)
    * [.getAll(options)](#module_bedrock-account.getAll) ⇒ <code>Promise</code>
    * [.update(options)](#module_bedrock-account.update) ⇒ <code>Promise</code> \| [<code>ExplainObject</code>](#ExplainObject)
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

### bedrock-account.get(options) ⇒ <code>Promise</code> \| [<code>ExplainObject</code>](#ExplainObject)
Retrieves an account by ID or email.

**Kind**: static method of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> \| [<code>ExplainObject</code>](#ExplainObject) - - Returns a Promise that resolves to
  the account record (`{account, meta}`) or an ExplainObject if
  `explain=true`.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| options | <code>object</code> |  | The options to use. |
| [options.id] | <code>string</code> |  | The ID of the account to retrieve. |
| [options.email] | <code>string</code> |  | The email of the account to retrieve. |
| [options.explain] | <code>boolean</code> | <code>false</code> | An optional explain boolean. |

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
| [options._allowPending] | <code>boolean</code> | <code>false</code> | For internal use only;   allows finding records that are in the process of being created. |

<a name="module_bedrock-account.update"></a>

### bedrock-account.update(options) ⇒ <code>Promise</code> \| [<code>ExplainObject</code>](#ExplainObject)
Updates an account by overwriting it with new `account` and / or `meta`
information. In both cases, the expected `sequence` must match the existing
account, but if `meta` is being overwritten, `sequence` can be omitted and
the value from `meta.sequence` will be used.

**Kind**: static method of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> \| [<code>ExplainObject</code>](#ExplainObject) - - Returns a Promise that resolves to
  `true` if the update succeeds or an ExplainObject if `explain=true`.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>object</code> | The options to use. |
| options.id | <code>string</code> | The ID of the account to update. |
| [options.account] | <code>object</code> | The new account information to use. |
| [options.meta] | <code>object</code> | The new meta information to use. |
| [options.sequence] | <code>number</code> | The sequence number that must match the   current record prior to the update if given; can be omitted if `meta` is   given and has, instead, the new `sequence` number (which must be one more   than the existing `sequence` number). |

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

<a name="ExplainObject"></a>

## ExplainObject : <code>object</code>
An object containing information on the query plan.

**Kind**: global typedef  
<a name="ExplainObject"></a>

## ExplainObject : <code>object</code>
An object containing information on the query plan.

**Kind**: global typedef  
<a name="ExplainObject"></a>

## ExplainObject : <code>object</code>
An object containing information on the query plan.

**Kind**: global typedef  
