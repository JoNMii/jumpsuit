# JumpSuit's protocol specification

The protocol's endianness is big-endian.
Messages are serialized with a custom protocol before being sent. This document references JumpSuit's protocol.
Strings are always encoded as UTF-8. When the protocol mandates the length of a string, it is implied the length is an amount of bytes.
Angles are always encoded as brads.
When a value takes only one byte, 1 means enabled and 0 means disabled.


## Notation

Possible values for a field are noted:
 * with a number for the packet type (ex: `4`)
 * with lowercase words for variables (ex: `player name`)
 * with lowercase words between double quotes for strings variables (`"player name"`)
 * with lowercase words starting with a uppercase character for enumerations (ex: `Error Type`)
 * with uppercase snake case for packets and subpayloads (ex: `CREATE_PRIVATE_LOBBY`)
Values dubbed `unused bits` are not used, but are present to complete a byte.

Values are enclosed in boxes.
The minus signs (-) indicates the value is required and not repeated.
The tilde (~) indicates the value is optional and not repeated.
The equal sign (=) indicates the value is optional and repeated.

```
+-------+
| value |
+-------+

+~~~~~~~~~~~~~~~~+
| optional value |
+~~~~~~~~~~~~~~~~+

+================+
| repeated value |
+================+
```


## Subpayloads

Subpayloads are sequences of bytes which are always defined after the same scheme. They often represent an entity with multiples properties.
They might be used several times in a packet or in packets with different types.


#### PLANET
```
       2B            2B           2B
+--------------+--------------+--------+
| x-coordinate | y-coordinate | radius |
+--------------+--------------+--------+
```


#### ENEMY
```
      2B              2B           1B
+--------------+--------------+------------+
| x-coordinate | y-coordinate | Appearance |
+--------------+--------------+------------+
```

`Appearance` must be either:
 0. `enemyBlack1`
 1. `enemyBlack2`
 2. `enemyBlack3`
 3. `enemyBlack4`
 4. `enemyBlack5`
 5. `enemyBlue1`
 6. `enemyBlue2`
 7. `enemyBlue3`
 8. `enemyBlue4`
 9. `enemyBlue5`
 10. `enemyGreen1`
 11. `enemyGreen2`
 12. `enemyGreen3`
 13. `enemyGreen4`
 14. `enemyGreen5`
 15. `enemyRed1`
 16. `enemyRed2`
 17. `enemyRed3`
 18. `enemyRed4`
 19. `enemyRed5`


#### PLAYER
```
      2B             2B               1B            1B        1b         1b       3b        3b           1B        0-255B
+--------------+--------------+-----------------+-------+------------+---------+------+------------+-------------+--------+
| x-coordinate | y-coordinate | attached planet | angle | looks left | jetpack | Team | Walk Frame | name length | "name" |
+--------------+--------------+-----------------+-------+------------+---------+------+------------+-------------+--------+
```

If `attached planet`'s value is 255, the player is not attached to a planet.
`Walk Frame` must be either:
 0. `duck`
 1. `hurt`
 2. `jump`
 3. `stand`
 4. `walk1`
 5. `walk2`
`Team` must be either:
 0. `blue team`
 1. `beige team`
 2. `green team`
 3. `pink team`
 4. `yellow team`


#### SHOT
```
      2B              2B         1B
+--------------+--------------+-------+
| x-coordinate | y-coordinate | angle |
+--------------+--------------+-------+
```


#### LESSER_PLANET
```
     1B         1B
+----------+----------+
| Owned By | progress |
+----------+----------+
```

Owned By must be either:
 0. `neutral`
 1. `blue team`
 2. `beige team`
 3. `green team`
 4. `pink team`
 5. `yellow team`


#### LESSER_SHOT
```
      2B              2B
+--------------+--------------+
| x-coordinate | y-coordinate |
+--------------+--------------+
```


#### LESSER_PLAYER
```
      2B             2B               1B           1B         1b         1b           3b            3b
+--------------+--------------+-----------------+-------+------------+---------+--------------+------------+
| x-coordinate | y-coordinate | attached planet | angle | looks left | jetpack | useless bits | Walk Frame |
+--------------+--------------+-----------------+-------+------------+---------+--------------+------------+
```


#### SERVER
```
    1B         2B                1B
+--------+-------------+----------------+
| secure | server port | PARTIAL_SERVER |
+--------+-------------+----------------+
```


#### PARTIAL_SERVER
```
          1B               0-255B            1B            0-255B
+--------------------+---------------+-----------------+------------+
| server name length | "server name" | mod name length | "mod name" |
+--------------------+---------------+-----------------+------------+
```


## Packets

The first byte of every packet determines its type. A payload may be placed after this first byte. The payload may contain subpayloads or payloads.

```
   1B       ?B
+------+-----------
| Type | payload...
+------+-----------
```

There are 21 packet types.



### Master server ↔ Game server

Game servers will attempt to connect to the master server's websocket at "/game_servers".

#### REGISTER_SERVER (game server → master server)
```
 1B     ?B
+---+--------+
| 0 | SERVER |
+---+--------+
```


### Client ↔ Master server

Clients will attempt to connect to the master server's websocket at "/clients".

#### ADD_SERVERS (master server → client)
```
 1B        ?*6B
+---+================+
| 1 | PARTIAL_SERVER |
+---+================+
```


#### REMOVE_SERVERS (master server → client)
```
 1B      2B
+---+===========+
| 2 | server id |
+---+===========+
```


#### RESOLVE (client → master server)
```
 1B      2B
+---+-----------+
| 3 | server id |
+---+-----------+
```


#### RESOLVED (master server → client)
```
 1B     1B        2B        2B    16B
+---+--------+-----------+------+------+
| 4 | secure | server id | port | ipv6 |
+---+--------+-----------+------+------+
```

The `server id` is sent in case the client has time to send two `RESOLVE` before a `RESOLVED` arrives.



### Client ↔ Game server

#### SET_NAME (client → game server)
```
 1B       0B-?B
+---+---------------+
| 5 | "player name" |
+---+---------------+
```

The player must send this message before `CONNECT` or `CREATE_PRIVATE_LOBBY`.


#### SET_NAME_BROADCAST (game server → client)
```
 1B      1B           0B-?B
+---+-----------+---------------+
| 6 | player id | "player name" |
+---+-----------+---------------+
```


#### CREATE_PRIVATE_LOBBY (client → game server)
```
 1B              1B
+---+---------------------------+
| 7 | maximum amount of players |
+---+---------------------------+
```

The game server will respond with CONNECT_ACCEPTED.


#### CONNECT (client → game server)
```
 1B      4B
+---+~~~~~~~~~~+
| 8 | lobby id |
+---+~~~~~~~~~~+
```

The game server will respond with CONNECT_ACCEPTED.
The `lobby id` must be set only if the player wishes to connect to a specific lobby (this is the only way to access private lobbies). In this case the server might respond with an ERROR rather than with CONNECT_ACCEPTED.


#### ERROR (game server → client)
```
 1B       1B
+---+------------+
| 9 | Error Type |
+---+------------+
```

`Error Type` must be either:
 0. no lobby avalaible
The game server will respond with CONNECT_ACCEPTED.
 1. no slot avalaible


#### CONNECT_ACCEPTED (game server → client)
```
  1B      4B          1B           1B             2B                2B              3b           1b          1b           1b          1b           1b            ?B
+----+----------+-----------+--------------+----------------+-----------------+--------------------------+-----------+------------+-----------+-------------+------------+
| 10 | lobby id | player id | homograph id | universe width | universe height | unused bits | beige team | blue team | green team | pink team | yellow team | ADD_ENTITY |
+----+----------+-----------+--------------+----------------+-----------------+-------------+------------+-----------+------------+-----------+-------------+------------+
```

The homograph id is used to distinguish players with the same name. It is unique for every player with the same name.


#### LOBBY_STATE (game server → client)
```
  1B       1B         1B
+----+-------------+~~~~~~~+
| 11 | Lobby State | timer |
+----+-------------+~~~~~~~+
```

`Lobby State` must be either:
 0. warmup
 1. game started
 2. game over


#### ADD_ENTITY (game server → client)
```
  1B       1B           ?*6B         1B        ?*5B         1B       ?*5B     ?B
+----+---------------+========+--------------+=======+-------------+======+========+
| 12 | planet amount | PLANET | enemy amount | ENEMY | shot amount | SHOT | PLAYER |
+----+---------------+========+--------------+=======+-------------+======+========+
```


#### REMOVE_ENTITY (game server → client)
```
  1B        1B           ?*1B           1B          ?*1B         1B         ?*1B       ?*1B
+----+---------------+===========+--------------+==========+-------------+=========+===========+
| 13 | planet amount | planet id | enemy amount | enemy id | shot amount | shot id | player id |
+----+---------------+===========+--------------+==========+-------------+=========+===========+
```


#### GAME_STATE (game server → client)
```
  1B       1B           2B           ?*3B           ?*1B          ?*4B           ?*7B
+----+-------------+-----------+===============+=============+=============+===============+
| 14 | your health | your fuel | LESSER_PLANET | enemy angle | LESSER_SHOT | LESSER_PLAYER |
+----+-------------+-----------+===============+=============+=============+===============+
```


#### PLAYER_CONTROLS (client → game server)
```
  1B      2b         1b    1b      1b       1b         1b           1b
+----+-------------+------+-----+--------+---------+-----------+------------+
| 15 | unused bits | jump | run | crouch | jetpack | move left | move right |
+----+-------------+------+-----+--------+---------+-----------+------------+
```


#### ACTION_ONE (client → game server)
```
  1B    2B
+----+-------+
| 16 | angle |
+----+-------+
```


#### ACTION_TWO (client → game server)
```
  1B    2B
+----+-------+
| 17 | angle |
+----+-------+
```


#### CHAT (client → game server)
```
  1B      1B
+----+-----------+
| 18 | "message" |
+----+-----------+
```


#### CHAT_BROADCAST (game server → client)
```
  1B      1B          ?B
+----+-----------+-----------+
| 19 | player id | "message" |
+----+-----------+-----------+
```

serverModBufs[i]
#### SCORES (game server → client)
```
  1B       4B
+----+============+
| 20 | team score |
+----+============+
```

There are as many `team score`s as there are teams. Which teams are playing has already been sent with a CONNECT_ACCEPTED message.
The order `team score`s can be mapped to teams is as follow (provided the teams are enabled): beige team, blue team, green team, pink team, yellow team.