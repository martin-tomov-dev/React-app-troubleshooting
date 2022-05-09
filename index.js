const express = require('express')
const socket = require('socket.io')
const cors = require('cors')
const { genRoomCode } = require('./utils')
const { questions } = require('./questions')
const { deciderQuestions } = require('./deciderQuestions')
const path = require('path')

// App setup
const app = express()
app.use(cors())

app.use(express.static(path.join(__dirname, 'build')))

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'))
})

const server = app.listen(process.env.PORT || 4000, () =>
  console.log('Server is running at 4000')
)

// Socket setup
const io = socket(server, {
  cors: {
    origin: '*'
  }
})

const mysql = require('mysql');

var connection = mysql.createConnection({
  // Plesk Server DB info
  // host: "80.120.169.226",
  // database: "web07014_whoisgame",
  // user: "web07014_db_user",
  // password: "Rw$3r5h6",
  // charset: 'utf8mb4',
  host: "localhost",
  user: "root",
  password: "",
  database: "whois",
  charset: 'utf8mb4'
});

connection.connect((err) => {
  if (err) {
    console.error('error connecting: ' + err.stack);
    return;
  }
  console.log('• Database connected as id ' + connection.threadId);
});


const POINT_INCREMENT_VALUE = 1

let clientRooms = []
let backupLastData = [];
let questionCounter = 0
let electedThisRound = []
let results = []
let interval = ''
let isDraw = false
let isCalled = false
let playersCounter = 0
var selectQry = "select clientRooms from testDB  ";

connection.query(selectQry, (err, rows) => {
  if (err) {
    console.log(err.message);
  }

  // console.log('success',rows[0])
  if (rows && rows.length) {
    let myData = []
    rows.forEach(e => {
      if (!myData.includes(JSON.parse(e.clientRooms))) {
        myData.push(JSON.parse(e.clientRooms))
        //  console.log(myData,myData.length)
        if (rows.length == myData.length) {
          clientRooms = [...myData]
          //  console.log(myData.length,clientRooms)
        }
      }

    })
  }
  // Once done, release connection
  // connection.end();
});

io.on('connection', socket => {
  function cleanIpTable() {
    //check the database ,if this ip exists more than 5 times under 30 mins
    var selectQry = "select * from ipTable";

    connection.query(selectQry, (err, rows) => {
      if (err) {
        console.log(err.message);

      }

      // console.log('success',rows[0])
      if (rows && rows.length) {

        if (rows.length > 0) {

          rows.forEach(e => {
            let d = new Date()
            console.log(e.id)
            if (d.getTime() - e.createdAt.getTime() > 1800000) {
              var delSql = 'DElETE FROM ipTable WHERE id = ?';
              var value = [e.id]
              connection.query(delSql, value, (err) => {

                if (err) {
                  console.log(err);
                }
                console.log('cleaned ip' + e.ip)
                // Once done, release connection
                // connection.end();

              });
            }
            return
          })
        }
      }

    });
  }

  cleanIpTable()

  socket.on('disconnect', reason => console.log(reason))

  socket.on('newGame', handleNewGame)
  socket.on('joinGame', handleJoinGame)
  socket.on('removePlayer', removePlayer)
  socket.on('gameStart', startGame)
  socket.on('vote', handleVote)
  socket.on('startTimer', startTimer)
  socket.on('firstQuestion', handleFirstQuestion)
  socket.on('rejoin', handleRejoin)

  function sendPlayers(roomCode) {
    const players = clientRooms.filter(room => room.roomCode === roomCode)
    io.in(roomCode).emit('getPlayers', players[0]?.players)
  }

  function verifyIP(ip, callback) {
    //check the database ,if this ip exists more than 5 times under 30 mins
    var selectQry = "select * from ipTable where ip=? ";
    var value = [ip]

    connection.query(selectQry, value, (err, rows) => {
      if (err) {
        console.log(err.message);
        //if on localhost,make it return true,
        // on production,return false
        callback(true)
      }

      // console.log('success',rows[0])
      if (rows && rows.length) {

        if (rows.length > 5) {
          //if on localhost,make it return true,
          // on production,return false
          callback(false)

        } else {
          callback(true)
        }
      }
      // Once done, release connection
      // connection.end();
    });
  }


  function storeIp(ip) {
    // console.log(ip)
    var insertQry = "INSERT INTO ipTable (ip) VALUES(?)";

    var values = [ip];

    connection.query(insertQry, values, (err) => {
      if (err) {
        console.log(err.message);
        return
      }
      //  res.send(rows);
      console.log('success')
      // Once done, release connection
      // connection.end();
    });
  }

  function handleNewGame(data) {
    let roomCode = genRoomCode()
    const player = {
      socketId: socket.id,
      ready: false,
      teamname: data.teamname,
      username: data.username,
      points: 0,
      voted: false
    }
    let session = {
      roomCode: roomCode,
      seconds: 30,
      decider_seconds: 20,
      completed: 100,
      qCount: 0,
      players: [player],
      gameQuestions: [...questions],
      deciderQuestions: [...deciderQuestions],
      hasEnded: false
    }
    storeIp(socket.request.connection.remoteAddress)

    verifyIP(socket.request.connection.remoteAddress, (result) => {
      if (result) {

        clientRooms.push(session)
        // console.log(clientRooms)
        var insertQry = "INSERT INTO testDB (clientRooms,roomCode) VALUES(?,?)";

        var values = [JSON.stringify(session), roomCode];

        connection.query(insertQry, values, (err) => {
          if (err) {
            console.log(err.message);
          }
          //  res.send(rows);
          // console.log('success',rows)
          // Once done, release connection
          // connection.end();
        });
        socket.emit('gameCode', roomCode)

        // Send the game creator
        socket.emit('gameCreator', player)

        socket.join(roomCode)

        // removeEndedGames()
      } else {
        socket.emit('ipBlocked', data)
        return
      }
    })
  }

  function handleJoinGame(data) {
    const room = io.sockets.adapter.rooms.get(data.roomCode)

    let allUsers
    if (room) {
      allUsers = room.size
    }

    // limitExceeded
    if (allUsers >= 6) {
      socket.emit('limitExceeded', 'limitExceeded')
      return
    }

    let numClients = 0
    if (allUsers) {
      numClients = allUsers
    }

    if (numClients === 0) {
      socket.emit('unknownCode', 'unknown Code')
      return
    }

    if (clientRooms.find(room => room.roomCode == data.roomCode).players.find(player => player.username == data.username)) {
      console.log('Please Choose another name')
      socket.emit('name-duplication', data)
      return
    } else {
      storeIp(socket.request.connection.remoteAddress)
      verifyIP(socket.request.connection.remoteAddress, (result) => {
        if (result) {
          storeIp(socket.request.connection.remoteAddress)

          // Add user in the corresponding session
          clientRooms.map(room => {
            if (room.roomCode === data.roomCode) {
              room.players.push({
                socketId: socket.id,
                ready: false,
                teamname: data.teamname,
                username: data.username,
                points: 0,
                voted: false
              })
            }
          })


          var selectQry = "select clientRooms from testDB where roomCode=?  ";
          var value = [data.roomCode]

          connection.query(selectQry, value, (err, rows) => {
            if (err) {
              console.log(err.message);
            }
            //  res.send(rows);
            //  console.log('success',rows[0])
            if (rows && rows.length) {
              let existingSession = JSON.parse(rows[0].clientRooms)
              // console.log(JSON.parse(rows[0].clientRooms))

              existingSession.players.push({
                socketId: socket.id,
                ready: false,
                teamname: data.teamname,
                username: data.username,
                points: 0,
                voted: false
              })

              let updateQry = "UPDATE testDB SET clientRooms =? WHERE roomCode=?";
              let values = [JSON.stringify(existingSession), data.roomCode]
              connection.query(updateQry, values, (err) => {
                if (err) {
                  console.log(err.message);
                }
                console.log('success')
              })
              // rows.forEach(e=>{
              //   // if(!myData.includes(JSON.parse(e.clientRooms))){
              //   //    myData.push(JSON.parse(e.clientRooms))
              //   // console.log(myData,myData.length)
              //   // if(rows.length==myData.length){
              //   //   clientRooms=[...myData]
              //   //   console.log(myData.length,clientRooms)
              //   // }
              //   // }

              //   e

              // })
            }
            // Once done, release connection
            // connection.end();
          });

          socket.join(data.roomCode)

          // Sends data to clients once a person joins the room
          sendPlayers(data.roomCode)
          // data.roomCode ||
          const players = clientRooms.filter(room => room.roomCode === data.roomCode)
          socket.emit('gameCreator', players[0]?.players[0])
        } else {
          socket.emit('ipBlocked', data)
          return
        }
      })
    }
  }

  function removePlayer(player) {
    let roomCode

    clientRooms.forEach(room => {
      room.players.map(p => {
        if (p.socketId === player.socketId) {
          roomCode = room.roomCode
          room.players = room.players.filter(
            p => p.socketId !== player.socketId
          )
        }
      })
    })

    sendPlayers(roomCode)
  }

  function startGame(roomCode) {
    questionCounter = 0
    results = []
    sendPlayers(roomCode)
    io.in(roomCode).emit('gameStarted', true)

    clientRooms.forEach(room => {
      if (room.roomCode === roomCode) {
        room.interval = interval = setInterval(() => {
          if (room.qCount >= 7) {
            room.seconds = room.seconds - 1
            room.completed = room.completed - 5
          } else {
            room.seconds = room.seconds - 1
            room.completed = room.completed - 3.3333
          }
        }, 1000)
      }
    })
  }

  function removeDuplicates(data, key) {
    return [...new Map(data.map(item => [key(item), item])).values()]
  }

  function mode(arr) {
    return arr
      .sort(
        (a, b) =>
          arr.filter(v => v.username === a.username).length - arr.filter(v => v.username === b.username).length
      )
      .pop()
  }

  function increasePlayerPoints() {
    clientRooms.forEach(room => {
      // Increase the points of the elected users
      room.players.map(p => {
        electedThisRound.map(elP => {
          if (elP.player.socketId === p.socketId) {
            p.points += POINT_INCREMENT_VALUE

          }
        })

        if (p.points >= 100) {
          // console.log('here')
          room.hasEnded = true
        }

        // console.log(p.points)
      })
    })
  }

  function haveAllVoted() {
    let haveAllVoted = true

    clientRooms.forEach(room => {
      // if (room.qCount >= 7) {

      // } else {
      room.players.forEach(player => {
        // console.log(player.voted)
        if (player.voted === false) {
          haveAllVoted = false

          return haveAllVoted
        }
      })
      // }
    })

    return haveAllVoted
  }

  function handleVote(data) {
    // console.log(data)
    let haveVoted = true

    electedThisRound.push(data)

    electedThisRound = removeDuplicates(
      electedThisRound,
      player => player.socketId
    )
    console.log("electedThisRound", electedThisRound);
    // Mark the voter as voted
    clientRooms.forEach(room => {
      room.players.map(p => {
        // console.log('p', p)
        if (p.socketId === data.socketId) {
          p.voted = true
        }
      })
    })

    // If there isn't an interval or all of the user's have voted record user's data.
    if (!interval || true) {
      //increasePlayerPoints();

      // If all players have voted move to next question
      clientRooms.forEach(room => {
        if (room.roomCode === data.roomCode) {
          let allHaveVoted = haveAllVoted()

          room.players.forEach(player => {
            // If player reaches 10 points send players for statistics
            if (player.points >= 100 && allHaveVoted) {
              sendPlayers(data.roomCode)
              // Remove the game room
              clientRooms = clientRooms.filter(
                r => r.roomCode !== data.roomCode
              )
              clearInterval(interval)
            }
          })

          let players = []

          electedThisRound.forEach(player => {
            // console.log(player.player)
            //here we will do 1st person voted thing
            if (room.qCount >= 7) {
              results.push(player.player)
              console.log(results, 'results')
              io.in(data.roomCode).emit('results', results)
              // room.qCount++
            } else {
              players.push(player.player)
            }
          })

          room.players.map(player => {
            if (player.voted === false) {
              haveVoted = false
            }
          })

          // Send the next question and the most voted player
          if (haveVoted) {

            let highestVotedPlayer = mode(players)

            // Remove duplicates for electedThisRound
            let playersDup = []

            electedThisRound.forEach(player => {
              playersDup.push(player.player)
              // console.log(player.player)
            })

            let setElected = removeDuplicates(
              playersDup,
              player => player.username
            )

            let draw = false

            // Handle what happens if we have a voting draw
            clientRooms.forEach(room => {
              if (room.roomCode === data.roomCode) {
                console.log(setElected.length, room.players.length)
                if (setElected.length === room.players.length) {
                  console.log(setElected.length, room.players.length)
                  highestVotedPlayer = {
                    username: 'It\'s a draw!',
                    message: ''
                  }
                  isDraw = true
                  io.in(data.roomCode).emit('isDraw', isDraw)
                  io.in(data.roomCode).emit('results', results)
                  //old
                  draw = true
                  room.qCount++
                }
              }
            })

            if (!draw) {
              room.qCount++
              increasePlayerPoints()
            }

            if (draw === false) {
              results.push(highestVotedPlayer)
              io.in(data.roomCode).emit('results', results)
            }

            if (room.qCount >= 7) {
              room.seconds = 20
              room.completed = 100
            } else {
              room.seconds = 30
              room.completed = 100
            }
            console.log("HandleVote Questions", room.gameQuestions)

            const rndInt = Math.floor(Math.random() * room.gameQuestions.length)

            io.in(data.roomCode).emit('highestVotedPlayer', highestVotedPlayer)

            io.in(data.roomCode).emit('nextQuestion', {
              question: room.gameQuestions[rndInt],
              counter: room.qCount
            })

            if (room.qCount >= 7) {
              const rndInt = Math.floor(
                Math.random() * room.deciderQuestions.length
              )
              io.in(data.roomCode).emit('nextQuestionTime', {
                question: room.deciderQuestions[rndInt],
                counter: room.qCount
              })

              // Remove used question
              room.deciderQuestions.splice(rndInt, 1)
              io.in(data.roomCode).emit('tick', {
                seconds: room.seconds,
                completed: room.completed
              })
            }
            // if (draw === false) {
            //   // Remove used question
            // }
            room.gameQuestions.splice(rndInt, 1)

            // Reset players vote check
            room.players.forEach(player => {
              player.voted = false
            })

            // Reset elected this round
            electedThisRound = []
          }
        }
      })
    }
  }

  function startTimer(data) {
    let room

    clientRooms.forEach(r => {
      if (r.roomCode === data.roomCode) {
        room = r
        if (r.seconds === 0) {
          if (r.qCount >= 7) {
            const rndInt = Math.floor(
              Math.random() * room.deciderQuestions.length
            )
            io.in(data.roomCode).emit('nextQuestionTime', {
              question: room.deciderQuestions[rndInt],
              counter: room.qCount
            })
            io.in(data.roomCode).emit('tick', {
              seconds: room.seconds,
              completed: room.completed
            })

            io.in(data.roomCode).emit('questionCount', questions.length)

            console.log("StartTimer Questions(if)", room.gameQuestions)

            // Remove used question
            room.deciderQuestions.splice(rndInt, 1)
          } else {
            r.seconds = 30
            r.completed = 100

            r.qCount++

            console.log("StartTimer Questions(else)", room.gameQuestions)
            const rndInt = Math.floor(Math.random() * room.gameQuestions.length)
            io.in(data.roomCode).emit('nextQuestionTime', {
              question: room.gameQuestions[rndInt],
              counter: room.qCount
            })
            clientRooms.forEach(room => {
              room.players.map(p => {
                // console.log('p', p)
                  p.voted = false;
              })
            })
            electedThisRound = [];
            backupLastData.push({
              question: room.gameQuestions[rndInt],
              counter: room.qCount,
              roomCode: data.roomCode
            })

            // Remove used question
            room.gameQuestions.splice(rndInt, 1)
          }
        }
      }
    })

    if (room) {
      io.in(data.roomCode).emit('tick', {
        seconds: room.seconds,
        completed: room.completed
      })
      io.in(data.roomCode).emit('questionCount', questions.length)
    }
  }

  function handleFirstQuestion(roomCode) {
    // if (isCalled === false) {
    clientRooms.forEach(room => {
      if (room.roomCode === roomCode) {
        playersCounter ++
        console.log("playersCounter", playersCounter)
        if(playersCounter === room.players.length) {
          const rndInt = Math.floor(Math.random() * room.gameQuestions.length)
          console.log("random value", rndInt)
          io.in(roomCode).emit('sendFirstQuestion', room.gameQuestions[rndInt])
          console.log("handleFirstQuestion", room.gameQuestions)
          // Remove used question
          if (isCalled === false) {
            isCalled = true
            console.log("handleFirstQuestion before", room.gameQuestions)
            room.gameQuestions.splice(rndInt, 1)
            console.log("handleFirstQuestion after", room.gameQuestions)
          }
          playersCounter = 0 
        }
        return
      }
    })
    // }
  }

  function handleRejoin(data) {
    console.log('rejoin')
    isCalled = false
    if (data && data.roomCode) {
      clientRooms.map(room => {
        if (room.roomCode === data.roomCode) {
          console.log(electedThisRound, "electedThisRound")
          electedThisRound.forEach((e) => {
            if (e.username == data.username) {
              e.socketId = socket.id
              console.log('updated')
            }
          })
          let myData = room.players.find(e => e.username == data.username)

          socket.join(data.roomCode);
          // console.log(room.players,"room",io.sockets.adapter.rooms.get(data.roomCode))
          if (myData && myData.socketId) {
            io.in(data.roomCode).emit('rejoinThisRoom', {
              myData: {
                socketId: socket.id,
                ready: myData.ready,
                teamname: myData.teamname,
                username: myData.username,
                points: myData.points,
                voted: myData.voted,
                roomCode: data.roomCode,
              },

              players: room.players
            })

            socket.on('resetMyData', function () {
              // console.log(backupLastData)
              io.in(data.roomCode).emit('backupLastData', { username: myData.username })
              room.players[room.players.indexOf(myData)] = {
                socketId: socket.id,
                ready: myData.ready,
                teamname: myData.teamname,
                username: myData.username,
                points: myData.points,
                voted: myData.voted
              };
            })
          }
        }
      })
    }
  }
})
