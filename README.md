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
<dt><a href="#Actor">Actor</a> : <code>object</code> | <code>null</code> | <code>undefined</code></dt>
<dd><p>An Actor may be an Object, undefined or null.</p>
</dd>
</dl>

<a name="module_bedrock-account"></a>

## bedrock-account

* [bedrock-account](#module_bedrock-account)
    * [.insert(options)](#module_bedrock-account.insert) ⇒ <code>Promise</code>
    * [.exists(options)](#module_bedrock-account.exists) ⇒ <code>Promise</code>
    * [.get(options)](#module_bedrock-account.get) ⇒ <code>Promise</code>
    * [.getAll(options)](#module_bedrock-account.getAll) ⇒ <code>Promise</code>
    * [.update(options)](#module_bedrock-account.update) ⇒ <code>Promise</code>
    * [.setStatus(options)](#module_bedrock-account.setStatus) ⇒ <code>Promise</code>
    * [.updateRoles(options)](#module_bedrock-account.updateRoles) ⇒ <code>Promise</code>
    * [.getCapabilities(options)](#module_bedrock-account.getCapabilities) ⇒ <code>Promise</code>
    * [.generateResource(options)](#module_bedrock-account.generateResource) ⇒ <code>object</code>

<a name="module_bedrock-account.insert"></a>

### bedrock-account.insert(options) ⇒ <code>Promise</code>
Inserts a new Account. The Account must contain `id`.

**Kind**: static method of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves to the database account record.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>object</code> | The options to use. |
| options.actor | [<code>Actor</code>](#Actor) | The actor or capabilities for performing   the action. |
| options.account | <code>object</code> | The account containing at least the minimum   required data. |
| [options.meta] | <code>object</code> | The meta information to include. |

<a name="module_bedrock-account.exists"></a>

### bedrock-account.exists(options) ⇒ <code>Promise</code>
Check for the existence of an account.

**Kind**: static method of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves to a boolean indicating account existence.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| options | <code>object</code> |  | The options to use. |
| options.actor | [<code>Actor</code>](#Actor) |  | The actor or capabilities for performing   the action. |
| [options.id] | <code>string</code> |  | The ID of the account to check. |
| [options.email] | <code>string</code> |  | The email address for the account. |
| [options.status] | <code>string</code> | <code>&quot;active&quot;</code> | The status to check for   (options: 'active', deleted'). |

<a name="module_bedrock-account.get"></a>

### bedrock-account.get(options) ⇒ <code>Promise</code>
Retrieves an Account.

**Kind**: static method of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves to `{account, meta}`.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>object</code> | The options to use. |
| options.actor | [<code>Actor</code>](#Actor) | The actor or capabilities for performing   the action. |
| options.id | <code>string</code> | The ID of the Account to retrieve. |

<a name="module_bedrock-account.getAll"></a>

### bedrock-account.getAll(options) ⇒ <code>Promise</code>
Retrieves all Accounts matching the given query.

**Kind**: static method of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves to the records that matched the query.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| options | <code>object</code> |  | The options to use. |
| options.actor | [<code>Actor</code>](#Actor) |  | The actor or capabilities for performing   the action. |
| [options.query] | <code>object</code> | <code>{}</code> | The query to use. |
| [options.fields] | <code>object</code> |  | The fields to include or   exclude. |
| [options.options] | <code>object</code> | <code>{}</code> | The options (eg: 'sort', 'limit'). |

<a name="module_bedrock-account.update"></a>

### bedrock-account.update(options) ⇒ <code>Promise</code>
Updates an Account.

**Kind**: static method of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves once the operation completes.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>object</code> | The options to use. |
| options.actor | [<code>Actor</code>](#Actor) | The actor or capabilities to perform the   action. |
| options.id | <code>string</code> | The ID of the account to update. |
| options.patch | <code>Array</code> | A JSON patch for performing the update. |
| options.sequence | <code>number</code> | The sequence number that must match the   current record prior to the patch. |

<a name="module_bedrock-account.setStatus"></a>

### bedrock-account.setStatus(options) ⇒ <code>Promise</code>
Sets an Account's status.

**Kind**: static method of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves once the operation completes.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>object</code> | The options to use. |
| options.actor | [<code>Actor</code>](#Actor) | The actor or capabilities to perform   the action. |
| options.id | <code>string</code> | The Account ID. |
| options.status | <code>string</code> | The status. |

<a name="module_bedrock-account.updateRoles"></a>

### bedrock-account.updateRoles(options) ⇒ <code>Promise</code>
Sets the Account's ResourceRoles from the given resource roles arrays.

**Kind**: static method of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves once the operation completes.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| options | <code>object</code> |  | The options to use. |
| options.actor | [<code>Actor</code>](#Actor) |  | The actor or capabilities to perform   the action. |
| options.id | <code>string</code> |  | The ID of the Account that is to be updated. |
| [options.add] | <code>Array</code> | <code>[]</code> | The resourceRoles to add. |
| [options.remove] | <code>Array</code> | <code>[]</code> | The resourceRoles to remove. |
| options.sequence | <code>number</code> |  | The sequence number that must match the   current record prior to the patch. |

<a name="module_bedrock-account.getCapabilities"></a>

### bedrock-account.getCapabilities(options) ⇒ <code>Promise</code>
Gets the capabilities for a given account.

**Kind**: static method of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves to an `actor` once the operation completes.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>object</code> | The options to use. |
| options.id | <code>string</code> | The ID of the Account to get the capabilities   for. |

<a name="module_bedrock-account.generateResource"></a>

### bedrock-account.generateResource(options) ⇒ <code>object</code>
Inserts a specified ID into a role's resource restriction array. The given
role is copied and the given ID is inserted into the new role's resource
restriction array.

**Kind**: static method of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>object</code> - The transformed role.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>object</code> | The options to use. |
| options.role | <code>object</code> | The role to transform. |
| options.id | <code>string</code> | The ID to insert into the resource array. |

<a name="Actor"></a>

## Actor : <code>object</code> \| <code>null</code> \| <code>undefined</code>
An Actor may be an Object, undefined or null.

**Kind**: global typedef  
