#!/usr/bin/env python3

import asyncio
import json
import multiprocessing
import queue
import struct
import logging
import time

import websockets
from websockets import WebSocketServerProtocol

logger = logging.getLogger('web_socket_logger')
logger.setLevel(logging.WARN)

DEFAULT_FPS = 20.0


class WebSocketServer(multiprocessing.Process):
    """
    The web socket server.
    """

    def __init__(self,
                 data_queue: multiprocessing.Queue,
                 control_queue: multiprocessing.Queue,
                 log_level: int,
                 websocket_port: int):
        """
        Configure the basics of this class

        :param data_queue: we will receive structured data from this queue
        :param control_queue: Future use as data to be sent back from whatever UI will hang of us
        :param log_level: The logging level we wish to use
        :param websocket_port: The port the web socket will be on
        """
        multiprocessing.Process.__init__(self)
        self._data_queue = data_queue
        self._control_queue = control_queue
        self._port = websocket_port
        self._exit_now = False
        self._fps = DEFAULT_FPS

        logger.setLevel(log_level)

    def exit_loop(self) -> None:
        # TODO: none of this is called, don't know why - yet
        logger.debug("exit_loop")
        self._exit_now = True
        # https://www.programcreek.com/python/example/94580/websockets.serve example 5
        asyncio.get_event_loop().call_soon_threadsafe(asyncio.get_event_loop().stop)
        logger.debug("exit exit_loop")

    def run(self):
        """
        The process start method
        :return: None
        """
        logger.info(f"Web Socket starting on port {self._port}")
        start_server = websockets.serve(self.handler, "0.0.0.0", self._port)

        asyncio.get_event_loop().run_until_complete(start_server)
        asyncio.get_event_loop().run_forever()

        logger.error("Web Socket server process exited")
        return

    async def handler(self, web_socket: WebSocketServerProtocol, path: str):
        """
        Handle both Rx and Tx to the client on of the websocket

        Tx goes from us (_data_queue) to the web client
        Rx comes from the web client to us (_control_queue)

        :param web_socket:
        :param path: Not used, default is '/'
        :return: None
        """

        client = web_socket.remote_address[0]
        logger.info(f"web socket serving client {client} {path}")

        tx_task = asyncio.ensure_future(
            self.tx_handler(web_socket))
        rx_task = asyncio.ensure_future(
            self.rx_handler(web_socket))
        done, pending = await asyncio.wait(
            [tx_task, rx_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
        logger.info(f"Exited web socket serving client {client} {path}")

    async def rx_handler(self, web_socket: WebSocketServerProtocol):
        """
        Receive JSON data from the client

        :param web_socket: The client connection
        :return: None
        """

        client = web_socket.remote_address[0]
        logger.info(f"web socket Rx for client {client}")
        try:
            async for message in web_socket:
                # message are json e.g.
                # {"name":"unknown","centreFrequencyHz":433799987.79296875,"sps":1500000,"bw":1500000,
                #                   "fftSize":"8192","sdrStateUpdated":false}
                # {"type":"fps","updated":true,"value":"10"}
                mess = json.loads(message)
                if mess['type'] == "fps":
                    # its for us
                    self._fps = int(mess['value'])
                else:
                    self._control_queue.put(message, timeout=0.1)

        except Exception as msg:
            logger.error(f"web socket Rx exception for {client}, {msg}")

    async def tx_handler(self, web_socket: WebSocketServerProtocol):
        """
        Send data packed binary data to the client

        :param web_socket: The client connection
        :return: None
        """

        client = web_socket.remote_address[0]
        logger.info(f"web socket Tx for client {client}")
        # NOTE this is not going to end
        try:
            while not self._exit_now:
                try:
                    # timeout on queue read so we can, if we wanted to, exit our forever loop
                    # only sending the peak spectrum so ignore the current magnitudes
                    display_on, sps, centre, _, peaks, time_start, time_end = self._data_queue.get(timeout=0.1)

                    centre_MHz = float(centre) / 1e6  # in MHz

                    # times are in nsec and javascript won't handle 8byte int so break it up
                    start_sec: int = int(time_start / 1e9)
                    start_nsec: int = int(time_start - start_sec * 1e9)
                    end_sec: int = int(time_end / 1e9)
                    end_nsec: int = int(time_end - end_sec * 1e9)

                    num_floats = int(peaks.size)
                    # pack the data up in binary, watch out for sizes
                    # ignoring times for now as still to handle 8byte ints in javascript
                    # !2if5i{num_floats}f{num_floats}f is in network order 2 int, 1 float, 5 int, N float
                    data_type: int = 1  # magnitude data
                    message = struct.pack(f"!2if5i{num_floats}f",  # format
                                          int(data_type),  # 4bytes
                                          int(sps),  # 4bytes
                                          float(centre_MHz),  # 4byte float (32bit)
                                          int(start_sec),  # 4bytes
                                          int(start_nsec),  # 4bytes
                                          int(end_sec),  # 4bytes
                                          int(end_nsec),  # 4bytes
                                          num_floats,  # 4bytes (N)
                                          *peaks)  # N * 4byte floats (32bit)

                    # send it off to the client
                    await web_socket.send(message)

                    # wait 1/fps before proceeding
                    # using asyncio.sleep() allows web_socket to service connections etc
                    end_time = time.time() + (1 / self._fps)
                    while (end_time - time.time()) > 0:
                        await asyncio.sleep(1 / self._fps)  # we will not sleep this long

                except queue.Empty:
                    # unlikely to every keep up so shouldn't end up here
                    await asyncio.sleep(0.1)

        except Exception as msg:
            logger.error(f"web socket Tx exception for {client}, {msg}")
