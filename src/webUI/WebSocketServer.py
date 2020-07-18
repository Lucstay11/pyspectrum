#!/usr/bin/env python3

import asyncio
import multiprocessing
import queue
import struct
import logging

import websockets

logger = logging.getLogger('web_socket_logger')
logger.setLevel(logging.ERROR)


class WebSocketServer(multiprocessing.Process):
    """
    The web socket server.
    """

    def __init__(self,
                 data_queue: multiprocessing.Queue,
                 control_queue: multiprocessing.Queue,
                 log_level: int):
        """
        Configure the basics of this class

        :param data_queue: we will receive structured data from this queue
        :param control_queue: Future use as data to be sent back from whatever UI will hang of us
        :param log_level: The logging level we wish to use
        """
        multiprocessing.Process.__init__(self)
        self._data_queue = data_queue
        self._control_queue = control_queue
        self._port = 5555
        self._exit_now = False

        logger.setLevel(log_level)

    def exit_loop(self) -> None:
        self._exit_now.set()

    def run(self):
        """
        The process start method
        :return: None
        """
        logger.info(f"Web Socket starting on port {self._port}")
        start_server = websockets.serve(self.serve_connection, "0.0.0.0", self._port)

        asyncio.get_event_loop().run_until_complete(start_server)
        asyncio.get_event_loop().run_forever()

        logger.error("Web Socket server process exited")
        return

    async def serve_connection(self, web_socket, path):
        """
        Serve a connection passed to us

        :param web_socket: The client connection
        :param path: not used
        :return: None
        """
        client = web_socket.remote_address[0]
        logger.info(f"web socket serving client {client}")
        # NOTE this is not going to end
        try:
            while not self._exit_now:
                try:
                    # timeout on queue read so we can, if we wanted to, exit our forever loop
                    display_on, sps, centre, spec, peak, time_start, time_end = self._data_queue.get(timeout=0.1)

                    num_floats = int(spec.size)
                    # pack the data up in binary, watch out for sizes
                    # ignoring times for now as still to handle 8byte ints in javascript
                    message = struct.pack(f"!5i{num_floats}f{num_floats}f",
                                          int(sps),  # 4bytes
                                          int(centre),  # 4bytes
                                          int(1000),  # 4bytes
                                          int(2000),  # 4bytes
                                          num_floats,  # 4bytes (N)
                                          *spec,  # N * 4byte floats (32bit)
                                          *peak)  # N * 4byte floats (32bit)

                    await web_socket.send(message)
                    await asyncio.sleep(1 / 20.0)  # max 20fps, so wait around this long before checking again
                except queue.Empty:
                    # unlikely to every keep up so shouldn't end up here
                    await asyncio.sleep(0.1)
        except Exception as msg:
            logger.info(f"web socket ended for {client}, {msg}")

        print("Web socket client exited")