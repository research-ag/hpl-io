# hpl - The high-performance ledger

## Demo

Test ledger canister id: rqx66-eyaaa-aaaap-aaona-cai

Demo frontend:  https://iimu7-hiaaa-aaaak-qaata-cai.icp0.io/

The aggregators can be listed by calling "list all" in the demo frontend.

## Overview

The hpl is a new token ledger on the internet computer (IC) that is designed from the ground up with a number of key features, goals and characteristics in mind that 
differentiate it, sometimes radically, from other ledgers.
These characteristics are as follows.

### Multi-token ledger

Thousands of tokens can live in the same ledger.
This reduces the friction to create a new token down to making a canister call and paying a fee.
With a single-token ledger it is necessary to obtain ledger source code, modify it, audit it, deploy it and maintain the resulting ledger canister. Here, all that is done for you. 

Furthermore, a multi-token ledger allows more general transactions such as atomic swaps.

### Performance of 10,000+ tps

The ledger is designed such that a Motoko implementation can process 10,000+ individual transactions per second in a single ledger canister,
where each transaction is a transfer for a random pair of from-to accounts.
The account model was designed with the performance of implementations in mind such that high speeds can be reached even when the data structures involved hold tens of millions of open accounts.
In other words, it was designed such that an implementation can have, for the most part, linear complexity.

### Throughput of 10,000 ingress messages

The ledger has two different interfaces for ingress messages and inter-canister calls.
The architecture is specifically designed such that 10,000 transactions submitted per second by independent external users can reach the ledger.
To achieve this, ingress messages go through aggregators on different subnets.
It is planned to have ~20 aggregators on 20 different subnets and have each aggregator receive ~500 tps.

Going through an aggregator unavoidably introduces latency for transactions submitted by ingress messages.
The protocol is designed to keep the latency for frontends as small as possible
given the extra inter-canister hop.

### Protection against unsolicited deposits 

Users have to allow incoming transfers into their accounts.
This is done to avoid regulatory problems with tainted coins and unwanted airdrops.
It also avoids security problems resulting from a poisened transaction history or transaction spam.

### Payment flows

Multiple payment flows such as push, pull, approve-transfer and allowances are natively supported through the single concept of virtual accounts.
This simplifies the programming of services that deal with hpl tokens.

### Standard-compliance

The goals of the hpl are quite new.
It is therefore unfortunately not possible to comply with ICRC-1 or other standards.
For example, in the case of ICRC-1, there are two limiting factors that make it impossible:

* The ICRC-1 API is specifically designed for a single token per canister.
* With ICRC-1, the call to submit a transaction replies directly with the transfer's success or failure. This is incompatible with an additional inter-canister hop that works in batches.

## Account model

### Tokens

We currently support only fungible tokens.
A fungible token is identified by its asset id (type `nat`).
Token quantities are represented as a `nat` that must fit in 64 bits.
Consequently, the total supply of any tokens is limited to 2^64 - 1. 

### Principals and subaccounts

Accounts are owned by principals. 
A principal can have an arbitrary number of accounts.
The accounts of a principal are numbered consecutively `0, 1, 2, ...`.
Hence, an account reference is a pair `(principal, subid)` where `subid` is a `nat`.

Each account has a *unit* which specifies the asset id that it can hold. 
The unit is permanent, i.e. cannot change.

Accounts have to be explicitly opened by the owner.
When opening a new account the owner specifies the unit. 
An owner can have multiple accounts for the same unit.

Transfers from or to accounts fail if the transferred asset id does not match the account unit.

### Virtual accounts (part 1)

Unlike in most other ledgers, it is not possible for one account owner `A` to deposit
tokens into any account of another owner `B` (even if the asset id matches the account unit).
Instead, `B` has to first grant access to the sender `A` on a per-account basis. 
This happens by opening so-called virtual accounts.
Without virtual accounts the only transfers possible would be for one owner to transfer between his own accounts.

A virtual account `V` of an owner `A` specifies:
* a *backing account* `X` which is an account of `A` in the sense above (also called a _physical_ account)
* an *access principal* `B`.
The only principal that can access `V` in a transfer, 
either as sending or receiving account,
is `B`.
Even `A` cannot, in general, access `V` in a transfer.
When a transfer is executed then any balance change affecting `V` is applied to `X`.

The access principal of a virtual account is permanent, i.e. cannot be changed.

A virtual account has a unit which is inherited from its backing account.
The backing account of a virtual account can be changed to a different one of the same unit.

Virtual accounts are referenced by their owner and a virtual account id which is a `nat`.
The virtual account ids are consecutive numbers `0, 1, 2, ...`.
Virtual accounts need to be openend explicitly by their owner.

A virtual account can be viewed as a "gated port" to a physical account:
it has a port id (the virtual account id) and is gated by the access principal.

Transfers created by a principal `A` can:
* send from a physical account of `A` to another physical account of `A`, or
* send from a physical account of `A` to a virtual account of any principal with access principal `A`, or
* send from a virtual account of any principal with access principal `A` to a physical account of `A`, or
* send from a virtual account of any principal with access principal `A` to another virtual account of any other principal with access principal `A`.

Note: We said above that the owner of a virtual account cannot, in general, access its virtual accounts in a transfer. The exception is the special case in which the access principal is equal to the owner, which is allowed.

### Virtual accounts (part 2)

Virtual accounts also have balances.
The balance of a virtual account `V` is independent of the balance in the backing subaccount `X`.
It can be lower or higher.
`V`'s balance can be freely set or adjusted up and down by the owner.

When a transfer is executed involving `V` then the transfer's balance change is applied to `V`'s balance *and* to `X`'s balance.
If the balance change is negative (i.e. the transfer is outgoing)
then there must be sufficient balance in `V` *and* in `X` or the tranfer will fail.

For incoming transfers, `V`'s balance can be used to track the cumulative deposits made by the access principal `B`.

For outgoing transfers `V`'s balance can be used as an allowance to `B` because `B` can withdraw only up to `V`'s balance even if `X`'s balance is higher.

Thus, virtual accounts as a concept have similarities with allowance and approve-transfer methods. 

### Transfers

A transfer is described by the following data:

|Field|Description|
|---|---|
|caller|The principal `A` who submits the transfer.|
|from|The account reference of the sending account. A physical account of `A` or a virtual account with access principal `A`.|
|to|The account reference of the receiving account. A physical account of `A` or a virtual account with access principal `A`.|
|asset id|The unit to transfer.|
|amount|The quantity to transfer or the directive `max`.|
|memo|An array of blobs.|

The amount directive `max` transfers the entire balance of the sending account at the time of execution of the transfer.

The memo can hold arbitrary meta data and is irrelevant for the execution of the transfer. 

In the future, additional optional fields will be added to specify a fee mode.

### Fees
The default fee mode is "sender-pays" and it charges a percentage of the transferred asset.
The percentage is 0.2 basis points.
As an example, transferring 5 ICP would cost 0.00002 * 5 ICP = 0.0001 ICP, which is the same as the native ICP ledger.
Larger transfers than 5 ICP would be more expensive when done on HPL and smaller transfers than 5 ICP would be cheaper than the native ICP ledger.

In the future, a fee mode may be added that charges the fee in a dedicated fee token. 
That way, the transferred asset would not get diminshed and the transfer fee may also be independent of the transferred value (rather than proportional to it).

## Transaction API for external users

The high-performance ledger (hpl) is a set of canisters spread over various subnets.
We describe here how external users interact with this set of canisters, collectively called the _hpl system_ or simply the _hpl_.
By external users we mean all clients who communicate with the IC via ingress messages such as wallet frontends, dfx, etc.
This section does not describe how other canisters interact with the hpl. 

See [Ingress API](ingress.md).

## Transaction API for canisters

This is not yet published.