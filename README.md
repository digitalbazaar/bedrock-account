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
<dt><a href="#Actor">Actor</a> : <code>Object</code> | <code>null</code> | <code>undefined</code></dt>
<dd><p>An Actor may be an Object, undefined or null.</p>
</dd>
</dl>

<a name="module_bedrock-account"></a>

## bedrock-account

* [bedrock-account](#module_bedrock-account)
    * [.insert](#module_bedrock-account.insert) ⇒ <code>Promise</code>
    * [.exists](#module_bedrock-account.exists) ⇒ <code>Promise</code>
    * [.get](#module_bedrock-account.get) ⇒ <code>Promise</code>
    * [.getAll](#module_bedrock-account.getAll) ⇒ <code>Promise</code>
    * [.update](#module_bedrock-account.update) ⇒ <code>Promise</code>
    * [.setStatus](#module_bedrock-account.setStatus) ⇒ <code>Promise</code>
    * [.updateRoles](#module_bedrock-account.updateRoles) ⇒ <code>Promise</code>
    * [.getCapabilities](#module_bedrock-account.getCapabilities) ⇒ <code>Promise</code>
    * [.manageIdentity](#module_bedrock-account.manageIdentity) ⇒ <code>Promise</code>
    * [.getManagerId](#module_bedrock-account.getManagerId) ⇒ <code>Promise</code>
    * [.generateResource(options)](#module_bedrock-account.generateResource) ⇒ <code>Object</code>

<a name="module_bedrock-account.insert"></a>

### bedrock-account.insert ⇒ <code>Promise</code>
Inserts a new Account. The Account must contain `id`.

**Kind**: static property of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves to the database account record.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>Object</code> | The options to use. |
| options.actor | [<code>Actor</code>](#Actor) | The actor or capabilities for performing   the action. |
| options.account | <code>Object</code> | The account containing at least the minimum   required data. |
| [options.meta] | <code>Object</code> | The meta information to include. |

<a name="module_bedrock-account.exists"></a>

### bedrock-account.exists ⇒ <code>Promise</code>
Check for the existence of an account.

**Kind**: static property of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves to a boolean indicating account existence.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| options | <code>Object</code> |  | The options to use. |
| options.actor | [<code>Actor</code>](#Actor) |  | The actor or capabilities for performing   the action. |
| [options.id] | <code>string</code> |  | The ID of the account to check. |
| [options.email] | <code>string</code> |  | The email address for the account. |
| [options.status] | <code>string</code> | <code>&quot;active&quot;</code> | The status to check for   (options: 'active', deleted'). |

<a name="module_bedrock-account.get"></a>

### bedrock-account.get ⇒ <code>Promise</code>
Retrieves an Account.

**Kind**: static property of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves to `{account, meta}`.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>Object</code> | The options to use. |
| options.actor | [<code>Actor</code>](#Actor) | The actor or capabilities for performing   the action. |
| options.id | <code>string</code> | The ID of the Account to retrieve. |

<a name="module_bedrock-account.getAll"></a>

### bedrock-account.getAll ⇒ <code>Promise</code>
Retrieves all Accounts matching the given query.

**Kind**: static property of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves to the records that matched the query.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| options | <code>Object</code> |  | The options to use. |
| options.actor | [<code>Actor</code>](#Actor) |  | The actor or capabilities for performing   the action. |
| [options.query] | <code>Object</code> | <code>{}</code> | The query to use. |
| [options.fields] | <code>Object</code> | <code>{}</code> | The fields to include or exclude. |
| [options.options] | <code>Object</code> | <code>{}</code> | The options (eg: 'sort', 'limit'). |

<a name="module_bedrock-account.update"></a>

### bedrock-account.update ⇒ <code>Promise</code>
Updates an Account.

**Kind**: static property of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves once the operation completes.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>Object</code> | The options to use. |
| options.actor | [<code>Actor</code>](#Actor) | The actor or capabilities to perform the   action. |
| options.id | <code>string</code> | The ID of the account to update. |
| options.patch | <code>Array</code> | A JSON patch for performing the update. |
| options.sequence | <code>number</code> | The sequence number that must match the   current record prior to the patch. |

<a name="module_bedrock-account.setStatus"></a>

### bedrock-account.setStatus ⇒ <code>Promise</code>
Sets an Account's status.

**Kind**: static property of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves once the operation completes.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>Object</code> | The options to use. |
| options.actor | [<code>Actor</code>](#Actor) | The actor or capabilities to perform   the action. |
| options.id | <code>string</code> | The Account ID. |
| options.status | <code>string</code> | The status. |

<a name="module_bedrock-account.updateRoles"></a>

### bedrock-account.updateRoles ⇒ <code>Promise</code>
Sets the Account's ResourceRoles from the given resource roles arrays.

**Kind**: static property of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves once the operation completes.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| options | <code>Object</code> |  | The options to use. |
| options.actor | [<code>Actor</code>](#Actor) |  | The actor or capabilities to perform   the action. |
| options.id | <code>string</code> |  | The ID of the Account that is to be updated. |
| [options.add] | <code>Array</code> | <code>[]</code> | The resourceRoles to add. |
| [options.remove] | <code>Array</code> | <code>[]</code> | The resourceRoles to remove. |

<a name="module_bedrock-account.getCapabilities"></a>

### bedrock-account.getCapabilities ⇒ <code>Promise</code>
Gets the capabilities for a given account.

**Kind**: static property of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves to an `actor` once the operation completes.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>Object</code> | The options to use. |
| options.id | <code>string</code> | The ID of the Account to get the capabilities   for. |
| [options.identities] | <code>Array</code> | A set of identity IDs to restrict   capabitilies to; if unspecified, all identity capabilities will be   included. |

<a name="module_bedrock-account.manageIdentity"></a>

### bedrock-account.manageIdentity ⇒ <code>Promise</code>
Assumes management over the given identity.

**Note** This method requires the capability to update *the identity*. This
means that the actor must have authenticated as that identity (i.e. `actor`
must include the capability to update the identity).

**Kind**: static property of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves once the operation completes.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>Object</code> | The options to use. |
| options.actor | [<code>Actor</code>](#Actor) | The actor or capabilities to perform the   action. |
| options.accountId | <code>string</code> | The ID of the account to make the   manager of an identity. |
| options.identityId | <code>string</code> | The ID of the identity to manage. |

<a name="module_bedrock-account.getManagerId"></a>

### bedrock-account.getManagerId ⇒ <code>Promise</code>
Retrieves the ID of the Account that manages the given identity or `null`
if there is no managing account set.

**Kind**: static property of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Promise</code> - Resolves to the account ID or `null`.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>Object</code> | The options to use. |
| options.actor | [<code>Actor</code>](#Actor) | The actor or capabilities for performing   the action. |
| options.identity | <code>string</code> | The ID of the identity to get the   managing Account for. |

<a name="module_bedrock-account.generateResource"></a>

### bedrock-account.generateResource(options) ⇒ <code>Object</code>
Inserts a specified ID into a role's resource restriction array. The given
role is copied and the given ID is inserted into the new role's resource
restriction array.

**Kind**: static method of [<code>bedrock-account</code>](#module_bedrock-account)  
**Returns**: <code>Object</code> - The transformed role.  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>Object</code> | The options to use. |
| options.role | <code>Object</code> | The role to transform. |
| options.id | <code>string</code> | The ID to insert into the resource array. |

<a name="Actor"></a>

## Actor : <code>Object</code> \| <code>null</code> \| <code>undefined</code>
An Actor may be an Object, undefined or null.

**Kind**: global typedef  
