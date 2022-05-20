var clients = [];
var io;

var start_listening = async function (server) {
    console.info('Socket service started ....')
    /**
     * Listen on provided port, on all network interfaces.
    */
    io = require('socket.io')(server, {
        cors: { origin: '*' }
    });

    io.on('connection', (socket) => {

        socket.on('disconnect', () => {
            for (var i = 0, len = clients.length; i < len; ++i) {
                var c = clients[i];

                if (c.clientId == socket.id) {
                    active_status(false, c.customId)
                    clients.splice(i, 1);

                    let d = {
                        isOnline: false,
                        user_id: c.customId
                    }

                    broadcast.all('users', d)
                    break;
                }
            }
        })

        socket.on('storeClientInfo', async function (data) {
            var clientInfo = new Object();
            clientInfo.customId = data.customId;
            clientInfo.clientId = socket.id;
            clients.push(clientInfo);
            socket.join(data.customId);

            broadcast.all('users', data)
            await active_status(true, data.customId);

        });
        
    });
}

var broadcast = {
    user: function (customId, event, data) {
        io.in(customId).emit(event, data)
        return 0;
    },
    all: function (event, data) {
        io.emit(event, data)
    }
}

module.exports = {
    connect: (server) => {
        start_listening(server)
    },

    broadcast: broadcast
};

