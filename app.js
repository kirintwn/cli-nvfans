const spawn = require("child_process").spawn;
const fs = require("fs");
const path = require("path");

const cmdType = {
    nvSettings: "nvSettings",
    nvSMI: "nvSMI"
};

class GPUobject {
    constructor(index , name) {
        this.index = index;
        this.name = name;
        this.temperature = 0;
        this.fanSpeed = 0;
        this.power = 0.0;
        this.toggleCustom = false;
        this.customSpeed = -1;
    }   
};

class Server {
    constructor() {
        this.customData = this.fetchCustomData();
        this.GPUlist = [];
    }

    executeCMD(targetCmdType , cmd) {
        return new Promise((resolve , reject) => {
            try {
                switch (targetCmdType) {
                    case cmdType.nvSettings:
                        cmd = "export DISPLAY=:0.0 && nvidia-settings " + cmd;
                        break;
                
                    case cmdType.nvSMI:
                        cmd = "nvidia-smi " + cmd;
                        break;
                }
                
                var cmdChild = spawn(cmd , [""] , {shell: true});
            }
            catch(e) {
                reject(e);
            }
    
            var res = "";
    
            cmdChild.stdout.on("data" , (data) => {
                res += data;
            });
    
            cmdChild.on("close" , () => {
                resolve(res);
            });
        });
        
    }

    async initGPUinfo() {
        let cmd = "-q gpus";
        try {
            const res = await this.executeCMD(cmdType.nvSettings , cmd);
            const resLines = res.split("\n");
            resLines.forEach((line) => {
                line = line.trim();
                const words = line.split(" ");
                if(words[0].charAt(0) === "[") {
                    const tmpIndex = parseInt(words[0].slice(1, -1) , 10);
                    const tmpName = (line.match(/\(([^)]+)\)/)[1]).slice(8);
                    var GPUtmp = new GPUobject(tmpIndex , tmpName);
                    this.GPUlist.push(GPUtmp);
                }
            });
            return this.GPUlist;
        } catch (error) {
            console.log(error);
            throw(error);
        } 

        
    }

    fetchCustomData() {
        try {
            var customSpeedData = fs.readFileSync(path.resolve(__dirname, "customSpeedData.json"));
            console.log(JSON.parse(customSpeedData));
            return JSON.parse(customSpeedData);
        }
        catch(e) {
            console.log(e);
            return [];
        }
    }

    interpolator(currentTemp) {
        if(currentTemp <= this.customData[0].temperature) {
            return this.customData[0].speed;
        }
        else if(currentTemp >= this.customData[this.customData.length - 1].temperature) {
            return this.customData[this.customData.length - 1].speed;
        }

        for(let i = 0 ; i < this.customData.length ; i++) {
            if(currentTemp === this.customData[i].temperature) {
                return this.customData[i].speed;
            }
            else if(currentTemp < this.customData[i].temperature) {
                if(this.customData[i-1].temperature === this.customData[i].temperature) {
                    return this.customData[i-1].speed;
                }
                else {
                    return parseInt(this.customData[i-1].speed + (this.customData[i].speed - this.customData[i-1].speed) * (currentTemp - this.customData[i-1].temperature) / (this.customData[i].temperature - this.customData[i-1].temperature) );
                }
            }
        }
    }

    async getPowerByIndex(index) {
        try {
            let cmd = `-q -i ${index} -d POWER`;
            const res = await this.executeCMD(cmdType.nvSMI , cmd);
            const resLines = res.split("\n");
            resLines.forEach((line) => {
                line = line.trim();
                const words = line.split(" ");
                if(words[1] === "Draw") {
                    this.GPUlist[index].power = parseFloat(words[20] , 10);
                    return;
                }
            });
        } catch (error) {
            console.log(error);
            throw(error);
        }
    }

    async getFanSpeedByIndex(index) {
        try {
            let cmd = `-q '[fan:${index}]/GPUCurrentFanSpeed'`;
            const res = await this.executeCMD(cmdType.nvSettings , cmd);
            this.GPUlist[index].fanSpeed = parseInt(res.split(" ")[5].slice(0 , -2) , 10);
        } catch (error) {
            console.log(error);
            throw(error);
        }    
    }

    async getTemperatureByIndex(index) {
        try {
            let cmd = `-q '[gpu:${index}]/GPUCoreTemp'`;
            const res = await this.executeCMD(cmdType.nvSettings , cmd);
            this.GPUlist[index].temperature = parseInt(res.split(" ")[5].slice(0 , -2) , 10);
        } catch (error) {
            console.log(error);
            throw(error);
        }
    }

    async setToggledByInedx(index , value) {
        try {
            let cmd  = `-a '[gpu:${index}]/GPUFanControlState=1'`;
            if(value === false) {
                cmd  = `-a '[gpu:${index}]/GPUFanControlState=0'`;
            }
    
            const res = await this.executeCMD(cmdType.nvSettings , cmd);
            this.GPUlist[index].toggleCustom = value;
        } catch (error) {
            console.log(error);
            throw(error);
        }
        
    }

    async setSpeedByIndex(index) {
        try {
            if(this.GPUlist[index].toggleCustom === true) {
                const targetSpeed = this.interpolator(this.GPUlist[index].temperature);
                this.GPUlist[index].customSpeed = targetSpeed;
                let cmd = `-a '[fan:${index}]/GPUTargetFanSpeed=${targetSpeed}'`;
                const res = await this.executeCMD(cmdType.nvSettings , cmd);
            }
        } catch (error) {
            console.log(error);
            throw(error);
        }
    }

    printStatus() {
        setInterval(() => {
            for(let i = 0 ; i < this.GPUlist.length ; i++) {
                process.stdout.write(`\x1b[35m${new Date().toLocaleTimeString("zh-Hant-TW" , { hour12: false })} \x1b[0m`);
                process.stdout.write(`[GPU${this.GPUlist[i].index} - ${this.GPUlist[i].name}] `);
                if(this.GPUlist[i].power.toFixed().toString().length < 3) {
                    process.stdout.write(" ");
                }
                process.stdout.write(`\x1b[31m${this.GPUlist[i].power.toFixed()}W \x1b[0m`);
                process.stdout.write(`\x1b[31m${this.GPUlist[i].temperature}°C \x1b[0m`);
                process.stdout.write(`\x1b[34m${this.GPUlist[i].fanSpeed}% (target:${this.GPUlist[i].customSpeed}%) \x1b[0m\r\n`);
            }
        } , 10000);
    }

    updater() {
        for(let i = 0 ; i < this.GPUlist.length ; i++) {
            this.setToggledByInedx(i , true);
        }
        setInterval(() => {
            for(let i = 0 ; i < this.GPUlist.length ; i++) {
                this.getPowerByIndex(i);
                this.getTemperatureByIndex(i);
                this.getFanSpeedByIndex(i);
                this.setSpeedByIndex(i);
            }
        } , 10000);

        setTimeout(() => {
            this.printStatus();
        } , 1000);
        
    }
};

var myServer = new Server();
myServer.initGPUinfo()
    .then(() => {
        myServer.updater();
    })
    .catch((e) => {
        console.log(e);
    });