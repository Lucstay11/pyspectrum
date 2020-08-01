/*
 * Copyright (c) 2019 Jeppe Ledet-Pedersen
 * This software is released under the MIT license.
 * See the LICENSE file for further details.
 *
 * Modified from original, not a lot though
 */

'use strict';

Spectrum.prototype.squeeze = function(value, out_min, out_max) {
    if (value <= this.min_db)
        return out_min;
    else if (value >= this.max_db)
        return out_max;
    else
        return Math.round((value - this.min_db) / (this.max_db - this.min_db) * out_max);
}

Spectrum.prototype.rowToImageData = function(bins) {
    for (var i = 0; i < this.imagedata.data.length; i += 4) {
        var cindex = this.squeeze(bins[i/4], 0, 255);
        var color = this.colormap[cindex];
        this.imagedata.data[i+0] = color[0];
        this.imagedata.data[i+1] = color[1];
        this.imagedata.data[i+2] = color[2];
        this.imagedata.data[i+3] = 255;
    }
}

Spectrum.prototype.addWaterfallRow = function(bins) {
    // Shift waterfall 1 row down
    this.ctx_wf.drawImage(this.ctx_wf.canvas,
        0, 0, this.wf_size, this.wf_rows - 1,
        0, 1, this.wf_size, this.wf_rows - 1);

    // Draw new line on waterfall canvas
    this.rowToImageData(bins);
    this.ctx_wf.putImageData(this.imagedata, 0, 0);

    var width = this.ctx.canvas.width;
    var height = this.ctx.canvas.height;

    // Copy scaled FFT canvas to screen. Only copy the number of rows that will
    // fit in waterfall area to avoid vertical scaling.
    this.ctx.imageSmoothingEnabled = false;
    var rows = Math.min(this.wf_rows, height - this.spectrumHeight);
    this.ctx.drawImage(this.ctx_wf.canvas,
        0, 0, this.wf_size, rows,
        0, this.spectrumHeight, width, height - this.spectrumHeight);
}

Spectrum.prototype.drawFFT = function(bins) {
    this.ctx.beginPath();
    this.ctx.moveTo(-1, this.spectrumHeight + 1);
    for (var i = 0; i < bins.length; i++) {
        var y = this.spectrumHeight - this.squeeze(bins[i], 0, this.spectrumHeight);
        if (y > this.spectrumHeight - 1)
            y = this.spectrumHeight + 1; // Hide underflow
        if (y < 0)
            y = 0;
        if (i == 0)
            this.ctx.lineTo(-1, y);
        this.ctx.lineTo(i, y);
        if (i == bins.length - 1)
            this.ctx.lineTo(this.wf_size + 1, y);
    }
    this.ctx.lineTo(this.wf_size + 1, this.spectrumHeight + 1);
    this.ctx.strokeStyle = "#fefefe";
    this.ctx.stroke();
}

Spectrum.prototype.drawSpectrum = function(bins) {
    var width = this.ctx.canvas.width;
    var height = this.ctx.canvas.height;

    // Fill with black
    this.ctx.fillStyle = "black";
    this.ctx.fillRect(0, 0, width, height);

    // FFT averaging
    if (this.averaging > 0) {
        if (!this.binsAverage || this.binsAverage.length != bins.length) {
            this.binsAverage = Array.from(bins);
        } else {
            for (var i = 0; i < bins.length; i++) {
                this.binsAverage[i] += this.alpha * (bins[i] - this.binsAverage[i]);
            }
        }
        bins = this.binsAverage;
    }

    // Max hold
    if (this.maxHold && !this.pause) {
        if (!this.binsMax || this.binsMax.length != bins.length) {
            this.binsMax = Array.from(bins);
        } else {
            for (var i = 0; i < bins.length; i++) {
                if (bins[i] > this.binsMax[i]) {
                    this.binsMax[i] = bins[i];
                } else {
                    // Decay
                    this.binsMax[i] = 1.0025 * this.binsMax[i];
                }
            }
        }
    }

    // Do not draw anything if spectrum is not visible
    if (this.ctx_axes.canvas.height < 1)
        return;

    // Scale for FFT
    this.ctx.save();
    this.ctx.scale(width / this.wf_size, 1);

    // Draw maxhold
    if (this.maxHold)
        this.drawFFT(this.binsMax);

    // Draw FFT bins
    this.drawFFT(bins);

    // Restore scale
    this.ctx.restore();

    // Fill scaled path
    this.ctx.fillStyle = this.gradient;
    this.ctx.fill();

    // Copy axes from offscreen canvas
    this.ctx.drawImage(this.ctx_axes.canvas, 0, 0);
}

Spectrum.prototype.updateAxes = function() {
    var width = this.ctx_axes.canvas.width;
    var height = this.ctx_axes.canvas.height;

    // Clear axes canvas
    this.ctx_axes.clearRect(0, 0, width, height);

    // Draw axes
    this.ctx_axes.font = "12px sans-serif";
    this.ctx_axes.fillStyle = "white";
    this.ctx_axes.textBaseline = "middle";

    // y-axis labels
    this.ctx_axes.textAlign = "left";
    var step = 10;
    for (var i = this.min_db + 10; i <= this.max_db - 10; i += step) {
        var y = height - this.squeeze(i, 0, height);
        this.ctx_axes.fillText(i, 5, y);

        this.ctx_axes.beginPath();
        this.ctx_axes.moveTo(20, y);
        this.ctx_axes.lineTo(width, y);
        this.ctx_axes.strokeStyle = "rgba(200, 200, 200, 0.40)";
        this.ctx_axes.stroke();
    }

    this.ctx_axes.textBaseline = "bottom";
    // Eleven frequency labels on x-axis
    for (var i = 0; i < 11; i++) {
        var x = Math.round(width / 10) * i;
        if (this.spanHz > 0) {
            var adjust = 0;
            if (i == 0) {
                this.ctx_axes.textAlign = "left";
                adjust = 3;
            } else if (i == 10) {
                this.ctx_axes.textAlign = "right";
                adjust = -3;
            } else {
                this.ctx_axes.textAlign = "center";
            }

            var freq = this.centerHz + this.spanHz / 10 * (i - 5);
            if (this.centerHz + this.spanHz > 1e9){
                freq = freq / 1e9;
                freq = freq.toFixed(3) + "G";
            }
            else if (this.centerHz + this.spanHz > 1e6){
                freq = freq / 1e6;
                freq = freq.toFixed(3) + "M";
            }
            else if (this.centerHz + this.spanHz > 1e3){
                freq = freq / 1e3;
                freq = freq.toFixed(3) + "k";
            }
            this.ctx_axes.fillText(freq, x + adjust, height - 3);
        }

        this.ctx_axes.beginPath();
        this.ctx_axes.moveTo(x, 0);
        this.ctx_axes.lineTo(x, height);
        this.ctx_axes.strokeStyle = "rgba(200, 200, 200, 0.40)";
        this.ctx_axes.stroke();
    }
}

Spectrum.prototype.addData = function(magnitudes, peaks) {
    if (!this.paused) {
        // remember the data so we can pause and still use markers
        this.mags = magnitudes;
        this.peaks = peaks;

        // magnitudes are from a single fft, peaks are from all the fft magnitudes since the last update
        // both magnitudes and peaks are same length
        if (magnitudes.length != this.wf_size) {
            this.wf_size = magnitudes.length;
            this.ctx_wf.canvas.width = magnitudes.length;
            this.ctx_wf.fillStyle = "black";
            this.ctx_wf.fillRect(0, 0, this.wf.width, this.wf.height);
            this.imagedata = this.ctx_wf.createImageData(magnitudes.length, 1);
        }
        if (this.live_magnitudes) {
            this.drawSpectrum(magnitudes);
            this.addWaterfallRow(magnitudes);
        } else {
            this.drawSpectrum(peaks);
            this.addWaterfallRow(peaks);
        }
        this.updateMarkers();
        this.resize();
    }
}

Spectrum.prototype.updateSpectrumRatio = function() {
    this.spectrumHeight = Math.round(this.canvas.height * this.spectrumPercent / 100.0);

    this.gradient = this.ctx.createLinearGradient(0, 0, 0, this.spectrumHeight);
    for (var i = 0; i < this.colormap.length; i++) {
        var c = this.colormap[this.colormap.length - 1 - i];
        this.gradient.addColorStop(i / this.colormap.length,
            "rgba(" + c[0] + "," + c[1] + "," + c[2] + ", 1.0)");
    }
}

Spectrum.prototype.resize = function() {
    var width = this.canvas.clientWidth;
    var height = this.canvas.clientHeight;

    if (this.canvas.width != width ||
        this.canvas.height != height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.updateSpectrumRatio();
    }

    if (this.axes.width != width ||
        this.axes.height != this.spectrumHeight) {
        this.axes.width = width;
        this.axes.height = this.spectrumHeight;
        this.updateAxes();
    }
}

Spectrum.prototype.setSpectrumPercent = function(percent) {
    if (percent >= 0 && percent <= 100) {
        this.spectrumPercent = percent;
        this.updateSpectrumRatio();
    }
}

Spectrum.prototype.incrementSpectrumPercent = function() {
    if (this.spectrumPercent + this.spectrumPercentStep <= 100) {
        this.setSpectrumPercent(this.spectrumPercent + this.spectrumPercentStep);
    }
}

Spectrum.prototype.decrementSpectrumPercent = function() {
    if (this.spectrumPercent - this.spectrumPercentStep >= 0) {
        this.setSpectrumPercent(this.spectrumPercent - this.spectrumPercentStep);
    }
}

Spectrum.prototype.toggleColor = function() {
    this.colorindex++;
    if (this.colorindex >= colormaps.length)
        this.colorindex = 0;
    this.colormap = colormaps[this.colorindex];
    this.updateSpectrumRatio();
}

Spectrum.prototype.setRange = function(min_db, max_db) {
    this.min_db = min_db;
    this.max_db = max_db;
    this.updateAxes();
}

Spectrum.prototype.rangeUp = function() {
    this.setRange(this.min_db - 5, this.max_db - 5);
}

Spectrum.prototype.rangeDown = function() {
    this.setRange(this.min_db + 5, this.max_db + 5);
}

Spectrum.prototype.rangeIncrease = function() {
    this.setRange(this.min_db - 5, this.max_db + 5);
}

Spectrum.prototype.rangeDecrease = function() {
    if (this.max_db - this.min_db > 10)
        this.setRange(this.min_db + 5, this.max_db - 5);
}

Spectrum.prototype.setCenterHz = function(hz) {
    this.centerHz = hz;
    this.updateAxes();
}

Spectrum.prototype.setCenterMHz = function(Mhz) {
    this.centerHz = Math.trunc(Mhz * 1e6);
    this.updateAxes();
}

Spectrum.prototype.setSpanHz = function(hz) {
    this.spanHz = hz;
    this.updateAxes();
}

Spectrum.prototype.setAveraging = function(num) {
    if (num >= 0) {
        this.averaging = num;
        this.alpha = 2 / (this.averaging + 1)
    }
}

Spectrum.prototype.incrementAveraging = function() {
    this.setAveraging(this.averaging + 1);
}

Spectrum.prototype.decrementAveraging = function() {
    if (this.averaging > 0) {
        this.setAveraging(this.averaging - 1);
    }
}

Spectrum.prototype.setPaused = function(paused) {
    this.paused = paused;
}

Spectrum.prototype.togglePaused = function() {
    this.setPaused(!this.paused);
}

Spectrum.prototype.setMaxHold = function(maxhold) {
    this.maxHold = maxhold;
    this.binsMax = undefined;
}

Spectrum.prototype.toggleMaxHold = function() {
    this.setMaxHold(!this.maxHold);
}

Spectrum.prototype.setLiveMags = function(live) {
    this.live_magnitudes = live
}

Spectrum.prototype.toggleLive = function() {
    this.setLiveMags(!this.live_magnitudes);
}

Spectrum.prototype.toggleFullscreen = function() {
    // TODO: Exit from full screen does not put the size back correctly
    // This is full screen just for the spectrum & spectrogram
    if (!this.fullscreen) {
        if (this.canvas.requestFullscreen) {
            this.canvas.requestFullscreen();
        } else if (this.canvas.mozRequestFullScreen) {
            this.canvas.mozRequestFullScreen();
        } else if (this.canvas.webkitRequestFullscreen) {
            this.canvas.webkitRequestFullscreen();
        } else if (this.canvas.msRequestFullscreen) {
            this.canvas.msRequestFullscreen();
        }
        this.fullscreen = true;
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
        this.fullscreen = false;
    }
}

Spectrum.prototype.onKeypress = function(e) {
    if (e.key == "f") {
        this.toggleFullscreen();
    } else if (e.key == "c") {
        this.toggleColor();
    } else if (e.key == "+") {
        this.incrementAveraging();
    } else if (e.key == "-") {
        this.decrementAveraging();
    } else if (e.key == "m") {
        this.toggleMaxHold();
    } else if (e.key == "l") {
        this.toggleLive();
    } else if (e.key == " ") {
        this.togglePaused();
    } else if (e.key == "ArrowUp") {
        this.rangeUp();
    } else if (e.key == "ArrowDown") {
        this.rangeDown();
    } else if (e.key == "ArrowLeft") {
        this.rangeDecrease();
    } else if (e.key == "ArrowRight") {
        this.rangeIncrease();
     } else if (e.key == "s") {
        this.incrementSpectrumPercent();
    } else if (e.key == "w") {
        this.decrementSpectrumPercent();
    }
}

Spectrum.prototype.handleWheel = function(evt){
    if (evt.buttons ==0) {
        if (evt.deltaY > 0){
            this.rangeUp();
        }
        else{
            this.rangeDown();
        }
    } else if(evt.buttons == 4) {
        if (evt.deltaY > 0){
            this.rangeIncrease();
        }
        else{
            this.rangeDecrease();
        }
    }
}

Spectrum.prototype.setLiveMarker = function(message, x, y) {
    this.liveMarker_on=true;
    this.liveMarker_text=message;
    this.liveMarker_x = x;
    this.liveMarker_y = y;
}

Spectrum.prototype.addMarkerMHz = function(frequencyMHz, x_pos) {
    let marker = {};
    marker['xpos'] = parseInt(x_pos);
    marker['freqMHz'] = frequencyMHz;
    let delta = 0;
    if (this.markersSet.size != 0){
        let as_array = Array.from(this.markersSet);
        let previous_marker = as_array[this.markersSet.size-1];
        delta = (frequencyMHz - previous_marker.freqMHz).toFixed(3);
    }
    // do we have this one already, note .has(marker) doesn't work
    let new_entry = true;
    for (let item of this.markersSet) {
        if (item.xpos == marker.xpos){
            new_entry = false;
        }
    }
    if (new_entry) {
        this.markersSet.add(marker);

        // add to table of markers
        let new_row="<tr><td>"+(this.markersSet.size-1)+"</td><td>"+frequencyMHz+"</td><td>"+delta+"</td></tr>";
        $('#marker_table').append(new_row);
    }
}

Spectrum.prototype.clearMarkers = function() {
    // clear the table
    //  $(this).parents("tr").remove();
    let num_rows=this.markersSet.size;
    for (let i=num_rows; i>0; i--) {
        $("#marker_table tr:eq("+i+")").remove(); //to delete row 'i', delrowId should be i+1
    }
    this.markersSet.clear();
    this.liveMarker_on = false;
}

Spectrum.prototype.liveMarkerOff = function() {
    this.liveMarker_on=false;
}

// writeMarkers
Spectrum.prototype.updateMarkers = function() {
    // live marker line
    if (this.liveMarker_on){
        let height = this.ctx.canvas.height;
        this.ctx.beginPath();
        this.ctx.moveTo(this.liveMarker_x, 0);
        this.ctx.lineTo(this.liveMarker_x, height);
        this.ctx.setLineDash([10,10]);
        this.ctx.strokeStyle = "#f0f0f0";
        this.ctx.stroke();
    }
    // indexed marker lines
    for (let item of this.markersSet) {
        let xpos = item.xpos;
        let height = this.ctx.canvas.height;
        this.ctx.beginPath();
        this.ctx.moveTo(xpos, 0);
        this.ctx.lineTo(xpos, height);
        this.ctx.setLineDash([5,5]);
        this.ctx.strokeStyle = "#f0f0f0";
        this.ctx.stroke();
    }

    // marker texts
    var context = this.canvas.getContext('2d');
    context.font = '12px sans-serif';
    context.fillStyle = 'white';
    context.textAlign = "left";
    if (this.liveMarker_text != "" && this.liveMarker_on) {
        // are we past half way then put text on left
        if (this.liveMarker_x > (this.canvas.clientWidth/2)) {
            context.textAlign = "right";
        }
        context.fillText(this.liveMarker_text, this.liveMarker_x, this.liveMarker_y);
    }
    let marker_num=0;
    for (let item of this.markersSet) {
        let xpos = item.xpos;
        context.textAlign = "left";
        if (xpos > (this.canvas.clientWidth/2)) {
            context.textAlign = "right";
        }
        context.fillText(marker_num, xpos, 15);
        marker_num+=1;
    }
}

Spectrum.prototype.handleMouseMove = function(evt) {
    let mouse_ptr = this.getMouseValue(evt);
    if (mouse_ptr){
        this.setLiveMarker((mouse_ptr.freq / 1e6).toFixed(3)+"MHz", mouse_ptr.x, mouse_ptr.y);
    }
}

Spectrum.prototype.handleMouseClick = function(evt) {
    let mouse_ptr = this.getMouseValue(evt);
    if (mouse_ptr){
        // limit the number of markers
        if (this.markersSet.size < this.maxNumMarkers){
            this.addMarkerMHz((mouse_ptr.freq / 1e6).toFixed(3), mouse_ptr.x);
        }
    }
}

Spectrum.prototype.getMouseValue = function(evt) {
    // TODO: handle paused, currently it fills the canvas with text, need some sort of overlay?
    if (!this.paused){
        let rect = this.canvas.getBoundingClientRect();
        let x_pos = evt.clientX - rect.left;
        let per_hz = this.spanHz / (rect.right - rect.left);
        let freq_value = (this.centerHz - (this.spanHz / 2)) + (x_pos * per_hz);
        let power_value = 0;
        // TODO: get hold of power from spectrum or spectrogram
        // return the frequency in Hz, the power and where we are on the display
        return {
              freq: freq_value,
              power: power_value,
              x: x_pos,
              y: evt.clientY - rect.top
        };
    }
}

function Spectrum(id, options) {
    // Handle options
    this.centerHz = (options && options.centerHz) ? options.centerHz : 0;
    this.spanHz = (options && options.spanHz) ? options.spanHz : 0;
    this.wf_size = (options && options.wf_size) ? options.wf_size : 0;
    this.wf_rows = (options && options.wf_rows) ? options.wf_rows : 2048;
    this.spectrumPercent = (options && options.spectrumPercent) ? options.spectrumPercent : 25;
    this.spectrumPercentStep = (options && options.spectrumPercentStep) ? options.spectrumPercentStep : 5;
    this.averaging = (options && options.averaging) ? options.averaging : 0;
    this.maxHold = (options && options.maxHold) ? options.maxHold : false;

    // flag live magnitude spectrum or default of peaks over all spectrums seen since last spectrum
    this.live_magnitudes = (options && options.live_magnitudes) ? options.live_magnitudes : false;

    // markers
    this.markersSet = new Set();
    this.message = "";
    this.liveMarker_on = false;
    this.liveMarker_x = 0;
    this.liveMarker_y = 0;
    this.maxNumMarkers = 100; // that's a lot

    // Setup state
    this.paused = false;
    this.fullscreen = false;
    this.min_db = -80;
    this.max_db = 20;
    this.spectrumHeight = 0;

    // Colors
    this.colorindex = 0;
    this.colormap = colormaps[2];

    // Create main canvas and adjust dimensions to match actual
    this.canvas = document.getElementById(id);
    this.canvas.height = this.canvas.clientHeight;
    this.canvas.width = this.canvas.clientWidth;
    this.ctx = this.canvas.getContext("2d");
    this.ctx.fillStyle = "black";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Create offscreen canvas for axes
    this.axes = document.createElement("canvas");
    this.axes.height = 1; // Updated later
    this.axes.width = this.canvas.width;
    this.ctx_axes = this.axes.getContext("2d");

    // Create offscreen canvas for waterfall
    this.wf = document.createElement("canvas");
    this.wf.height = this.wf_rows;
    this.wf.width = this.wf_size;
    this.ctx_wf = this.wf.getContext("2d");

    // Trigger first render
    this.setAveraging(this.averaging);
    this.updateSpectrumRatio();
    this.resize();
}
