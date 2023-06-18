# hpl-io
The high-performance ledger

The red path happens if the aggregator has gone through an upgrade and lost its state.
The aggregator might be unreachable for the frontend (e.g. down for upgrade, frozen, deleted) 
or it might already be back up but with its former state deleted.

   Note that the status in the aggregator can go from "pending" back to
   "queued". This can happen if an inter-canister message carrying a batch
   fails.  The aggregator will automatically resend the batch, so after a
   while the status will go to "pending" a second time.

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

## Aggregator gid status state transitions
```mermaid
flowchart TD
Q[queued : n] -->|"new n <= old n"| Q
Q --> P[pending]
P --> U[unavailable]
P -->|any n| Q
```

## Ledger gid status state transitions

For valid gids the transition diagram is:
```mermaid
flowchart TD
W[awaited] --> P[processed]
W --> D[dropped]
```

The gid status can be `null` (invalid) if the internal stream id has not yet been issued.
The use of such a gid must go back to a bug in the calling code.
Theoretically, an invalid gid can become valid later once the internal stream id is eventually issued.
So the following transitions are also possible, 
though not very meaningful because they involve a bug in the calling code,
but are shown here for completeness:
```mermaid
flowchart TD
W[awaited] --> P[processed]
W --> D[dropped]
N --> P
N[null] --> W
N --> D
```

## Aggregator/Ledger combined gid status state transitions

This is only for valid gids, i.e. gids that have actually been obtained from an aggregator.
We ignore the `null` status at the ledger because it can only happen with a frontend bug.

```mermaid
flowchart TD
QA["queued:n/awaited"] -->|"aggregator<br>resets state<br>(orderly or not)"| UA["unavailable/awaited"]
UA -->|ledger<br>closes stream| UD2["unavailable/dropped"]
QA -->|batch sent<br>by aggregator| PA["pending/awaited"]
QA -->|"new n <= old n"| QA
PA -->|aggregator<br>reinstall| UA2["unavailable/awaited"]
UA2 -->|pending batch<br>was not delivered| UD2
UA2 -->|pending batch<br>was delivered| UP2["unavailable/processed"]
PA -->|batch received<br>by ledger| PP["pending/processed"]
PA -->|batch undelivered,<br>error received<br>by aggregator| QA
PP -->|aggregator reinstall| UP2
PP -->|response received<br>by aggregator| UP["unavailable/processed"]
PA -->|keep-alive<br>timeout| PD["pending/dropped"]
QA -->|keep-alive<br>timeout| QD["queued:n/dropped"]
PD -->|batch rejected by ledger,<br>response received<br>by aggregator| UD
QD -->|batch rejected by ledger,<br>response received<br>by aggregator| UD["unavailable/dropped"]


classDef green fill:#9f6
classDef orange fill:#f96
classDef red fill:#f77
class QD,PD,UD red
class UA,UA2,UD2,UP2 orange
class QA,PA,PP,UP green
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
