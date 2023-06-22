# hpl - The high-performance ledger

## Account model

### Tokens

The ledger is a multi-token ledger.
It currently supports only fungible tokens.
A fungible token is identified by its asset id (type `nat`).
Token quantities are represented as `nat`s that must fit in 128 bits.

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

Unlike in most other ledgers, it is not possible for one account owner A to deposit
tokens into any account of another owner B (even if the asset id matches the account unit).
Instead, B has to first grant access to the sender A on a per-account basis. 
This happens by opening so-called virtual accounts.
Without virtual accounts the only transfers possible would be for one owner to transfer between his own accounts.

A virtual account V of an owner A specifies:
* a *backing account* X which is an account of A in the sense above (a "physical" account)
* an *access principal* B.
The only principal that can access V in a transfer, 
either as sending or receiving account,
is B.
Even A cannot access V in a transfer.
When a transfer is executed then any balance change affecting V is applied to X.

The access principal of a virtual account is permanent, i.e. cannot be changed.

A virtual account has a unit which is inherited from its backing account.
The backing account of a virtual account can be changed to a different one of the same unit.

Virtual accounts are referenced by their owner and a virtual account id which is a `nat`.
The virtual account ids are consecutive numbers `0, 1, 2, ...`.
Virtual accounts need to be openend explicitly by their owner.

A virtual account can be viewed as a "gated port" to a physical account.
It has a port id (the virtual account id) and is gated by the access principal.

Transfers created by a principal A can:
* send from a physical account of A to another physical account of A
* send from a physical account of A to a virtual account of any principal with access principal A
* send from a virtual account of any principal with access principal A to a physical account of A
* send from a virtual account of any principal with access principal A to another virtual account of any other principal with access principal A

### Virtual accounts (part 2)

Virtual accounts also have balances.
The balance of a virtual account V is independent of the balance in the backing subaccount X.
It can be lower or higher.
V's balance can be freely set or adjusted up and down by the owner.

When a transfer is executed involving V then the transfer's balance change is applied to V's balance *and* to X's balance.
If the balance change is negative (i.e. the transfer is outgoing)
then there must be sufficient balance in V *and* in X or the tranfer will fail.

For incoming transfers V's balance can be used to track the cumulative deposits made by the access principal B.

For outgoing transfers V's balance can be used as an allowance to B because B can withdraw only up to V's balance even if X's balance is higher.

Thus virtual accounts as a concept have similarities with allowance and approve-transfer methods. 

### Transfers

A transfer is described by the following data:

|Field|Description|
|---|---|
|caller|The principal who submits the transfer.|
|from|The account reference of the sending account. A physical account of caller of a virtual account with access principal A.|
|to|The account reference of the receiving account. A physical account of caller of a virtual account with access principal A.|
|asset id|The unit to transfer.|
|amount|The quantity to transfer or the directive "max".|
|memo|An array of blobs.|

The amount directive "max" transfers the entire balance of the sending account at the time of execution of the transfer.

The memo can hold arbitrary meta data and is irrelevant for the execution of the transfer. 

## Transaction API for external users

The high-performance ledger (hpl) is a set of canisters spread over various subnets.
We describe here how external users interact with this set of canisters collectively called the "hpl system" or simply the "hpl".
By external users we mean all clients who communicate with the IC via ingress messages such as wallet frontends, dfx, etc.
This is not how other canisters interact with the hpl. 

The hpl consists of the ledger canister ("ledger") and multiple aggregator canisters ("aggregators") 
on different subnets.
External users submit transactions to any of the aggregators, normally a randomly chosen one.
The transaction will not execute right away during the submission call.
Instead, the transaction will only get queued inside the aggregator.
It will later be forwarded to the ledger in a batch together with other transactions
and will only then get executed in the ledger.
Forwarding to the ledger happens at regular intervals triggered by the heartbeat.

During submission the transaction undergoes only superficial checks.
It is not enough to say whether the transaction will succeed or not.
If the superficial checks pass then the aggregator returns a transaction id called "global id" (short "gid").
The user uses the gid to track the status and final result of the transaction via query calls.
Depending on the progress made, the user has to query the aggregator or the ledger, 
and sometimes both.

We will explain the possible status states of a transaction in detail now.
We will also provide a protocol that reliably determines the status of a transaction
in the face of race conditions and other edge cases such as canister restarts.

### Aggregator gid status states

The status of a transaction as per its gid can be queried via the `txStatus(gid)` query function.
It returns one of the following states or traps:

|State|Description|
|---|---|
|`queued:n`|The transaction is in the queue and the distance to the queue head is `n`.|
|`pending`|The transaction has been forwarded to the ledger but the aggregator does not know if the batch has been delivered. If the batch cannot be delivered then it will be retried.|
|`processed`|The transaction has been processed at the ledger.|
|`dropped`|The transaction has not been processed at the ledger, is not in flight to the ledger and will not be retried.|
|`unknown`|The gid was issued by a different aggregator or this aggregator has wiped its state.|
|trap|The gid is not valid, i.e. can not have been issued by any aggregator.|

In normal, idealized operation only the states `queued, pending, processed` are used.

The state `unknown` is introduced to allow more flexibility in the aggregator implementation
and to make the protocol overall more robust.
The protocol is designed such that the aggregator is allowed to wipe all or part of its state at any point in time, for example in an upgrade.
If this happens then the aggregator may forget the state of existing gids and thus state may transition to `unknown`.
Whether the aggregator ever wipes any parts of its state is left to the implementation. 

Clients are expected to handle the `unknown` response correctly by understanding that it can mean processed or dropped.

Transactions may get dropped for two different reasons:
1. If the aggregator wipes its state then queued transactions will get dropped because they cannot be retried.

2. If there is a delay in the communication between aggregator and ledger then, after a timeout,
the ledger will intentionally drop all outstanding transactions from that aggregator.
The reason to do so is to enhance the user experience.
For, if a transaction is known to be dropped, then the user can savely resubmit it to the same aggregator or to a different aggregator.
Without this mechanism the user would never be able to safely resubmit and would have to wait indefinitely, not knowing when the communication between the two canisters resumes.
In practice, the ledger drops transactions that it has not yet seen by resetting the communication protocol between aggeregator and ledger, 

#### Simple transition diagram
```mermaid
flowchart TD
Q[queued : n] -->|"new n <= old n"| Q
Q --> P[pending]
P --> D[dropped]
P --> L[processed]
P --> Q
L --> U[unknown]
D --> U
Q --> D
``` 

|Transition|Description|
|---|---|
|`queued:n` -> `queued:n'`|A prior batch is sent and the transaction moves closer to the head of the queue.|
|`queued` -> `pending`|The transaction is placed in a batch.|
|`pending` -> `queued`|The aggregator receives a response telling it that the batch containing the transaction could no be delivered. It is queued again and will be retried.|
|`pending` -> `processed`|The aggregator receives a response telling it that the batch has been processed by the ledger.|
|`processed` -> `unknown`|The aggregator wipes state (upgrade).|
|`dropped` -> `unknown`|The aggregator wipes state (upgrade).|
|`queued` -> `dropped`|The aggregator wipes state (upgrade).|
|`pending` -> `dropped`|The ledger resets communication (timeout).|

### Leder gid status states

The status of a transaction as per its gid can be queried via the `txStatus(gid)` query function.
It returns one of the following states or traps:

|State|Description|
|---|---|
|`awaited`|The transaction has not yet been received from the aggregator but can still come.|
|`processed`|The transaction has been processed.|
|`dropped`|The transaction has not been processed and cannot be processed anymore.|
|trap|The gid can not have been issued by any aggregator.|

The status `processed` does not yet say anything about the result of the transaction.
The result is a different data point. It can be `success` or `failure`.

#### Correspondence to aggregator states

If the aggregator returns `processed` or `dropped` then this has exactly the same meaning as if the ledger returned it.
The two canisters may just become aware of the states at different points in time.
That is why we use the same name for states even though they come from different canisters.

However, `awaited` and `pending` are not the same.
In a sense `awaited` is a wider class than `pending`.
The ledger returns `awaited` not only for gids that are `queued` at the aggregator.
It returns `awaited` also for gids that have not yet been issued by the aggregator and that may or may not be issued in the future.
That is why we do not use the name "pending" for a state at the ledger.

#### Transition diagram
```mermaid
flowchart TD
W[awaited] --> P[processed]
W --> D[dropped]
```

|Transition|Description|
|---|---|
|`awaited` -> `processed`|The transaction is received in a batch and processed.|
 `awaited` -> `dropped`|The ledger is notified about the fact that the aggregator has upgraded. Or the ledger has experienced an timeout and will the aggregator to reset the communication stream.|

### Client flow to track transaction status

Suppose the client (frontend) has submitted a transaction to an aggregator and received a gid.
Now it wants to track the transaction status and report progress to the user.
This happens in two steps.
The first step is to track progress until the status is processed or dropped.
If the status is processed then the second step is to query the ledger for the transaction result 
(success or failure).
The second step is a single query which does not require further discussion.

#### Protocol 1

To discuss the first step assume first an idealized world without the `unknown` status.
The client can poll the aggregator until the status is no longer queued or pending.
When the polling stops the status is either dropped or processed and the first step is completed.
While the status is queued the polling interval can be adjusted based on the distance n from the head of the queue.
The further away the slower we need to poll.

```mermaid
flowchart TD
    A("1.<br>query aggregator.txStatus(gid)<br>(unbounded polling loop)")

    %% Aggregator unbounded loop %%
    A --> R{result?}
    R -->|queued : n<br>pending| A 
    R -->|processed| PF[processed<br>with result]
    R -->|dropped| D["permanently<br>dropped"]
```
#### Protocol 2

We now take into account the unknown status.
With the unknown status it could happen that we missed the dropped or processed status.
It could have transitioned through one of those states within one polling interval.
So our polling only sees pending and then unknown.
In this case the client switches to polling the ledger for status.
The polling loop for the ledger is guaranteed to terminate in bounded time (which is the timeout configured in the ledger).

Note: We know the loop will terminate because 
* we know implicitly that the gid was issued by the aggregator 
* the aggregator gave status unknown before.

Proof: If the gid was issued by the aggregator then it can reach status unknown only if the aggregator wipes its state.
If the aggregator wipes its state then it also resets communication with the ledger.
This guarantees that the ledger is either processing the transaction
or awaiting it is going to time out,
in which case it will reach status dropped at the ledger.

The aggregator either closes a stream gracefully or abandons a stream. If it gets abandoned then it gets closed by the ledger after a timeout. If a stream is closed then all outstanding transactions are dropped.

```mermaid
flowchart TD
    %% Aggregator unbounded loop %%
    A("1.<br>query aggregator.txStatus(gid)<br>(unbounded polling loop)")
    A --> R{result?}
    R -->|queued : n<br>pending| A 
    R -->|processed| PF[processed<br>with result]
    R -->|dropped| D["permanently<br>dropped"]
    R -->|unknown| L 

    %% Ledger bounded loop %%
    L("2.<br>ledger.txStatus(gid)<br>(bounded polling loop)")
    L --> R2{result?}
    R2 -->|awaited| L
    R2 --> |processed| PF2[processed<br>with result]
    R2 -->|dropped| D2["permanently<br>dropped"]
```

#### Protocol 3

The latency in protocol 1 can be improved.
When a transaction is processed at the ledger then at first it remains pending at the aggregator.
It takes some time before the aggregator receives the response and the status transitions to processed there as well.
Therefore, the client can poll the aggregator until the status is pending and then start polling the ledger for status.
Polling stops when the status at the ledger is no longer awaited.
This is quicker overall.

However, delivery of a batch could fail and the status at the aggregator can go from pending back to queued.
Most clients will want to catch that, update it in the user frontend, and go back to polling the aggregator.
Therefore, it is advisable to time out polling the ledger 
and switch back to polling the aggregator at some point.

```mermaid
flowchart TD
    %% Aggregator unbounded loop %%
    A("1.<br>query aggregator.txStatus(gid)<br>(unbounded polling loop)")
    A --> R{result?}
    R -->|queued : n| A 
    R -->|processed| PF[processed<br>with result]
    R -->|dropped| D["permanently<br>dropped"]
    R -->|unknown| L 
    R -->|pending| L2 

    %% Ledger bounded loop %%
    L("2.<br>ledger.txStatus(gid)<br>(bounded polling loop)")
    L --> R2{result?}
    R2 -->|awaited| L
    R2 --> |processed| PF2[processed<br>with result]
    R2 -->|dropped| D2["permanently<br>dropped"]

    %% Ledger unbounded loop %%
    L2("3.<br>ledger.txStatus(gid)<br>(unbounded polling loop)")
    L2 --> R3{result?}
    R3 --> |processed| PF3[processed<br>with result]
    R3 -->|dropped| D3[permanently<br>dropped]
    R3 -->|awaited| L2
    R3 -->|"awaited<br>(after n polls)"| A
```

Note:
The discussion above assumed that the client knows the aggregator which has generated the gid.
If we do not know that then we have to start with one initial query to the ledger that will tell us the principal of the aggregator.

```mermaid
flowchart TD
    L("query ledger.txStatus(gid)<br>(initial query)") --> R1{result?}
    R1 -->|processed| P1[processed<br>with result]
    R1 -->|dropped| D1[permanently<br>dropped]
    R1 -->|awaited :<br>aggregator principal| A("1.<br>query aggregator.txStatus(gid)<br>(unbounded polling loop)")
```

The box at the bottom right is the starting point of the protocol above.