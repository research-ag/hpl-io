# hpl-io
The high-performance ledger

TODO:
* how does aggregator respond to txStatus after restart, before it has a new stream id?
* diagram needs transition arrow for aggregator restart
* ledger rejects if there is gap in then stream
* ledger responds with an error if a stream is closed

## Aggregator tx status state transitions
```mermaid
flowchart TD
Q[queued : n] -->|"new n <= old n"| Q
Q --> P[pending]
P --> U[unavailable]
P -->|any n| Q
```

## Ledger tx status state transitions

```mermaid
flowchart TD
W[awaited] --> successful
W --> failed
W --> dropped
invalid
```

## Aggregator/Ledger combined tx status state transitions

```mermaid
flowchart TD
QA["queued:n/awaited"] -->|batch sent<br>by aggregator| PA["pending/awaited"]
QA -->|"new n <= old n"| QA
PA -->|batch received<br>by ledger| PP["pending/processed"]
PA -->|batch undelivered,<br>error received<br>by aggregator| QA
PP -->|response received<br>by aggregator| UP["unavailable/processed"]
QA -->|keep-alive<br>timeout| QD["queued:n/dropped"]
PA -->|keep-alive<br>timeout| PD["pending/dropped"]
QD -->|batch rejected by ledger,<br>response received<br>by aggregator| UD["unavailable/dropped"]
PD -->|batch rejected by ledger,<br>response received<br>by aggregator| UD
```

## Frontend status querying

If the transaction is older then the frontend would expect that the transactions has already been processed. In this case it starts with step 1.

If the transaction is fresh then it may not have been processed yet. If the frontend remembers the principal of the aggregator to which it was submitted then the frontend starts with step 2, otherwise with step 1.

Under normal circumstances the green flow happens.

If the frontend polls slowly it may miss the `pending` state. This causes it to switch over to the orange flow.

In the rare case that the aggregator is unreachable (e.g. down for upgrade, frozen, deleted) the red path happens.

```mermaid
flowchart TD
    L("1.<br>query ledger.txStatus(gid)<br>(initial query)") --> R1{result?}
    R1 -->|successful/<br>failed| P1[processed<br>with status]
    R1 -->|awaited :<br>aggregator principal| A("2.<br>query aggregator.txStatus(gid)<br>(polling loop)")
    R1 -->|dropped| D1[permanently<br>dropped]
    A --> R2{result?}
    R2 -->|queued : n| A 
    R2 -->|aggregator<br>unreachable| L3["5.<br>query ledger.txStatus(gid)<br>(timeout loop, <= 2 min.)"]
    R2 -->|unavailable| LF("3.<br>query ledger.txStatus(gid)<br>(final query)")
    R2 -->|pending| L2("4.<br>query ledger.txStatus(gid)<br>(polling loop)")
    LF --> R3{result?}
    R3 -->|dropped| D2[permanently<br>dropped]
    R3 -->|awaited| I["cannot happen"]
    R3 -->|successful/<br>failed| P3
    L2 --> R4{result?}
    R4 --> |successful/<br>failed| P3[processed<br>with status]
    R4 -->|awaited| L2
    R4 -->|"awaited<br>(after n polls)"| A
    L3 --> R5{result?}
    R5 --> |successful/<br>failed| P4[processed<br>with status]
    R5 -->|awaited| L3
    R5 -->|dropped| D2
    

classDef green fill:#9f6
classDef orange fill:#f96
classDef red fill:#f77
class A,R2,L2,R4,P3 green
class LF,R3,P2,D2 orange
class L3,R5,D3,P4 red
```
