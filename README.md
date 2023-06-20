# hpl - The high-performance ledger

## Account model

### Tokens

The ledger manages balances in many different tokens.
It currently supports only fungible tokens.
A fungible token is identified by its asset id (type `nat`).
Token quantities are represented as `nat`s and must fit in 128 bits.

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
tokens into any account of another owner B (even if the asset id matches).
Instead, the B has to first grant access to the sender A. 
This happens by opening a so-called virtual account.
Without virtual accounts the only transfers possible would be between accounts of the same owner.

A virtual account V of an owner A specifies:
* a *backing account* X which is a "physical" account of A
* an *access principal* B which is any principal
The only principal that can access V in a transfer, 
either as sending or receiving account,
is B.
Even A cannot access V in a transfer.
When a transfer is executed then any balance change in V is applied to X.

The access principal if a virtual account is permanent, i.e. cannot be changed.

A virtual account has a unit which is inherited from its backing account.
The backing account of a virtual account can be changed to a different one of the same unit.

Virtual accounts are referenced by their owner and a virtual account id which is a `nat`.
The virtual account ids are consecutive numbers `0, 1, 2, ...`.
Virtual accounts need to be openend explicitly by their owner.

A virtual account can be viewed as a "gated port" to a physical account.
It has a port id (the virtual account id) and is gated by the access principal.

Transfers created by a principal A can:
* send from a physical account of A to another physical account of A
* send from a physical account of A to a virtual account with access principal A
* send from a virtual account with access principal A to a physical account of A
* send from a virtual account with access principal A to another virtual account with access principal A

### Virtual accounts (part 2)

Virtual accounts also have balances.
The balance of a virtual account V is independent of the balance in the backing subaccount X.
V's balance can be freely set or adjusted up and down by the owner.

When a transfer is executed involving V then the transfer's balance change is applied to V's balance *and* to X's balance.
If the balance change is negative (i.e. the transfer is outgoing)
then there must be sufficient balance in V *and* in X or the tranfer will fail.

For incoming transfers V's balance can be used to track the cumulative deposits made by the access principal B.

For outgoing transfers V's balance can be used as an allowance to B because B can withdraw only up V's balance even if X's balance is higher.

Thus virtual accounts as a concept have similarities with allowance and approve-transfer methods. 

## API for external users

The high-performance ledger (hpl) is a set of canisters spread over various subnets.
We describe here how external users interact with this set of canisters collectively called the "hpl system" or simply the "hpl".
By external users we mean all those who communicate with the IC via ingress messages such as wallet frontends, dfx, etc.
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

The status of a transaction as per its gid can be queried via the `gidStatus(gid)` query function.
It returns one of the following states:

|State|Description|
|---|---|
|`queued:n`|The transaction is in the queue and the distance to the queue head is `n`.|
|`pending`|The transaction has been forwarded to the ledger but the aggregator does not know if the batch has been delivered. If the batch cannot be delivered then it will be retried.|
|`processed`|The transaction has been processed at the ledger.|
|`dropped`|The transaction is not in flight to the ledger and will not be retried.|
|`unknown`|The gid was issued by a different aggregator (incl. this aggregator before the last restart). Hence the aggregator does not know.|
|trap|The gid is not valid, i.e. can not have been issued by any aggregator|

```mermaid
flowchart TD
Q[queued : n] -->|"new n <= old n"| Q
Q --> P[pending]
P --> U
P --> L[processed]
P --> Q
L --> U[unknown]
D --> U
Q --> D[dropped] 
``` 

The state transitions from `queued` to `pending` when the transaction is placed in a batch.

The state transitions from `pending` to `queued` when the aggregator receives a response telling it that the batch containing the transaction could no be delivered.

The state transitions from `pending` back to `processed` when the aggregator receives a response telling it that the batch has been processed by the ledger.

The state transitions from `queued` to `dropped` when the aggregator wants to reset the communication with the ledger. 
On a technical level, this means that the aggregator shuts down its current so-called "stream id" and needs to receive a new "stream id" from the ledger.
For example, this happens when the aggregator goes into stopping mode before an upgrade.
The ledger can also ask the aggregator to use a new stream id.

TODO: Can the state transition from `pending` directly to `dropped`? If the ledger ask the aggregator to use a new stream id and biggy-backs information about last processed position onto it.

The state transitions from `processed` to `unknown` when the aggregator restarts and wipes its state (e.g. upgrades).

*Note*: The protocol is designed such that the aggregator does not have to persist states across upgrades.

The state transitions from `dropped` to `unknown` when re-start communication after a communication reset.

The state transitions from `pending` directly to `unknown` only in exceptional cases.
For example, it can happen if the aggregator canister is deleted without first stopping it and is then re-installed.
This can cause outstanding call contexts to get dropped which in turn can transition a state from `pending` to `unknown`.

### Leder gid status states

The status of a transaction as per its gid can be queried via the `gidStatus(gid)` query function.
It returns one of the following states:

|State|Description|
|---|---|
|`awaited`|The transaction has not yet been received from the aggregator but can still come.|
|`processed`|The transaction has been processed.|
|`dropped`|The transaction has not been processed and cannot be processed anymore.|
|trap|The gid can not have been issued by any aggregator.|

For valid gids the transition diagram is:
```mermaid
flowchart TD
W[awaited] --> P[processed]
W --> D[dropped]
```

### Frontend flow diagram to track transaction status

```mermaid
flowchart TD
    L("1.<br>query ledger.txStatus(gid)<br>(initial query)") --> R1{result?}
    R1 -->|processed| P1[processed<br>with status]
    R1 -->|awaited :<br>aggregator principal| A("2.<br>query aggregator.txStatus(gid)<br>(polling loop)")
    R1 -->|dropped| D1[permanently<br>dropped]

    %% Aggregator %%
    A --> R2{result?}
    R2 -->|queued : n| A 
    R2 -->|unknown| L3["5.<br>query ledger.txStatus(gid)<br>(timeout loop, runs <= 2 min.)"]
    R2 -->|processed| LF("3.<br>query ledger.txStatus(gid)<br>(final query)")
    R2 -->|pending| L2("4.<br>query ledger.txStatus(gid)<br>(polling loop)")
    R2 -->|dropped| D4["permanently<br>dropped"]

    %% Ledger final query %%
    LF --> R3{result?}
    R3 -->|awaited| impossible
    R3 -->|dropped| D2[permanently<br>dropped]
    R3 -->|processed| P5[processed<br>with status]

    %% Ledger polling loop %%
    L2 --> R4{result?}
    R4 --> |processed| P3[processed<br>with status]
    R4 -->|awaited| L2
    R4 -->|"awaited<br>(after n polls)"| A

    %% Ledger timeout loop %%
    L3 --> R5{result?}
    R5 -->|awaited| L3
    R5 --> |processed| P4[processed<br>with status]
    R5 -->|dropped| D3["permanently<br>dropped"]
    
classDef green fill:#9f6
classDef orange fill:#f96
classDef red fill:#f77
class A,R2,L2,R4,P3,D4 green
class LF,R3,P2,D2,P5 green
class L3,R5,D3,P4 red
```

Notes:
* The diagram starts at the top with a query to the ledger. This is necessary if we do not know anything about the gid. If we already know the principal of the aggregator from which it was obtained then we can go directly to step 2 where the green path starts.
* The red path only happens if the aggregator has gone through an upgrade and lost its state.
* A "dropped" result should be confirmed by a query in update mode or by a certified variable. Only after that is it safe to resubmit the same transaction.
* If in step 2 the aggregator is unreachable (stopped, frozen, deleted) then we proceed as in step 5. However, if the loop does not terminate within 2 minutes then the aggregator may have come back up with its state intact and resumed operation. Hence we go back to step 2 if that happens. 

## TODO

Review ways to confirm a dropped state by a query in update mode or by a certified variable.

Review ways in which the aggregator can be unreachable. And in which ways it can recover from there with intact state.

   Transactions can be permanently dropped due to the following reasons:
   * The aggregator was frozen (due to low cycle balance) and remained frozen
   for a certain time (~2 minutes) while the transaction was queued.
   * The aggregator ran out of cycles entirely (hence got uninstalled) while
   the transaction was queued.
   * The communication from the aggregator's subnet to the ledger's subnet was
   interrupted for longer than a certain time (~2 minutes).
   * The aggregator was upgraded while the transaction was queued and the
   upgrade took longer than a certain time (~2 minutes).
   * The aggregator was upgraded while the transaction was queued and
   discarded its state.

## processBatch

* Ledger rejects if there is gap in then stream (as if message was not delivered). This is done because the aggregator handles it just like if the message was not delivered, in a unified way.
* Ledger accepts the message and responds with an error if the stream is closed. This is done because the aggregator has to programmatically handle this response.

## Aggregator/Ledger combined gid status state transitions

This is only for valid gids, i.e. gids that have actually been obtained from an aggregator.
We ignore the `null` status at the ledger because it can only happen with a frontend bug.

```mermaid
flowchart TD
QA["queued/awaited"] -->|"aggregator<br>resets state<br>(orderly or not)"| UA["unknown/awaited"]
UA -->|ledger<br>closes stream| UD2["unknown/dropped"]
QA -->|batch sent<br>by aggregator| PA["pending/awaited"]
PA -->|aggregator<br>force deletion| UA2["unknown/awaited"]
UA2 -->|pending batch<br>was not delivered| UD2
UA2 -->|pending batch<br>was delivered| UP2["unknown/processed"]
PA -->|batch received<br>by ledger| PP["pending/processed"]
PA -->|batch undelivered,<br>error received<br>by aggregator| QA
PP -->|aggregator<br>wipe state| UP
PP -->|response received<br>by aggregator| P["processed/processed"]
PA -->|keep-alive<br>timeout| PD["pending/dropped"]
QA -->|keep-alive<br>timeout| QD["queued/dropped"]
PD -->|batch rejected by ledger,<br>response received<br>by aggregator| D
QD -->|batch rejected by ledger,<br>response received<br>by aggregator| D["dropped/dropped"]
P --> UP["unknown/processed"]
D --> UD["unknown/dropped"]



classDef green fill:#9f6
classDef orange fill:#f96
classDef red fill:#f77
class QA,PA,PP,P,UP green
class UA,UD2,UA2,UP2 orange
class QD,PD,D,UD red
```

The orange and red colors symbolize the paths that involve a reset in the communication between aggregator and ledger, i.e. a change of stream id.
Orange means the aggregator initiated the reset,
red means the ledger initiated the reset.

## Frontend status querying

If the transaction is older then the frontend would expect that the transactions has already been processed. In this case it starts with step 1.

If the transaction is fresh then it may not have been processed yet. If the frontend remembers the principal of the aggregator to which it was submitted then the frontend starts with step 2, otherwise with step 1.

Under normal circumstances the green flow happens.

If the frontend polls slowly it may miss the `pending` state. This causes it to switch over to the orange flow.

The red path happens if the aggregator has gone through an upgrade and lost its state.
The aggregator might be unreachable for the frontend (e.g. down for upgrade, frozen, deleted) 
or it might already be back up but with its former state deleted.

```mermaid
flowchart TD
    L("1.<br>query ledger.txStatus(gid)<br>(initial query)") --> R1{result?}
    R1 -->|processed| P1[processed<br>with status]
    R1 -->|awaited :<br>aggregator principal| A("2.<br>query aggregator.txStatus(gid)<br>(polling loop)")
    R1 -->|dropped| D1[permanently<br>dropped]
    A --> R2{result?}
    R2 -->|queued : n| A 
    R2 -->|aggregator<br>unreachable| L3["5.<br>query ledger.txStatus(gid)<br>(timeout loop, <= 2 min.)"]
    R2 -->|unavailable| LF("3.<br>query ledger.txStatus(gid)<br>(final query)")
    R2 -->|pending| L2("4.<br>query ledger.txStatus(gid)<br>(polling loop)")
    LF --> R3{result?}
    R3 -->|awaited| L3
    R3 -->|dropped| D2[permanently<br>dropped]
    R3 -->|processed| P5[processed<br>with status]
    L2 --> R4{result?}
    R4 --> |processed| P3[processed<br>with status]
    R4 -->|awaited| L2
    R4 -->|"awaited<br>(after n polls)"| A
    L3 --> R5{result?}
    R5 -->|awaited| L3
    R5 -->|dropped| D3["permanently<br>dropped"]
    R5 --> |processed| P4[processed<br>with status]
    

classDef green fill:#9f6
classDef orange fill:#f96
classDef red fill:#f77
class A,R2,L2,R4,P3 green
class LF,R3,P2,D2,P5 orange
class L3,R5,D3,P4 red
```
