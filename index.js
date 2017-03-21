const _ = require('lodash')
const fs = require('fs-extra')
const wait = require('wait.for-es6')
const spawn = require('child_process').spawn
const yaml = require('js-yaml')
const path = require('path')
const meow = require('meow')
const scp = require('scp2')
const ssh = require('ssh2')
const temp = require('temp')
const argv = meow({
  description: false,
  help: 'deployMeteor --root=https://example.com [--source=./] [--config=./.deployMeteor.{json|yaml} [--config=/otherDeployConfiguration]]'
}, {
  default: {
    forwarded: 1,
    sleep: '1m',
    docker: 'pykiss/simple-meteor',
    source: './',
    config: './.deployMeteor'
  },
  string: ['source', 'config', 'docker', 'sleep']
})

if (!argv.flags.root) {
  argv.showHelp()
}

var expandConfigSSHs = function (configs) {
  var response = []
  configs.forEach(function (config) {
    if (!Array.isArray(config.ssh)) {
      response.push(config)
      return
    }
    config.ssh.forEach(function (ssh) {
      config = _.cloneDeep(config)
      config.ssh = ssh
      response.push(config)
    })
  })
  return response
}
var expandConfigHosts = function (configs) {
  var response = []
  configs.forEach(function (config) {
    if (config.ssh.host.toLowerCase) {
      response.push(config)
      return
    }
    if (config.ssh.privateKey) {
      config.ssh.privateKey = fs.readFileSync(ssh.privateKey)
    }
    config.ssh.host.forEach(function (host) {
      config = Object.assign({}, config)
      config.ssh.host = host
      response.push(config)
    })
  })
  return response
}

var expandConfigPorts = function (configs) {
  var response = []
  configs.forEach(function (config) {
    if (!Array.isArray(config.port)) {
      response.push(config)
      return
    }
    config.port.forEach(function (port) {
      config = Object.assign({}, config)
      config.port = port
      response.push(config)
    })
  })
  return response
}

const assert = function (bool, message) {
  if (bool) {
    return
  }
  console.log(message)
  argv.showHelp()
}

if (typeof argv.flags.source === 'object') {
  console.log('ERROR: \n  Only one --source parameter')
  argv.showHelp()
}

if (typeof argv.flags.config === 'string') {
  argv.flags.config = [argv.flags.config]
}

var configs = argv.flags.config.map(function (config) {
  console.log(config)
  if (config.match(/\.json$/)) {
    try {
      return fs.readJsonSync(config)
    } catch (e) {
      console.log('ERROR:\n  ', config, 'cannot be parsed or opened')
      argv.showHelp()
    }
  }
  if (config.match(/\.y(a?)ml$/)) {
    try {
      return yaml.safeLoad(fs.readFileSync(config, 'utf8'))
    } catch (e) {
      console.log('ERROR:\n  ', config, 'cannot be parsed or opened')
      argv.showHelp()
    }
  }
  if (config.match(/\.js$/)) {
    try {
      config = require(config)
      return config.config || config.callable(argv.flags)
    } catch (e) {
      console.log('ERROR:\n  ', config, 'cannot be required or error in js')
      argv.showHelp()
    }
  }
  console.log(config.match(/\.json/))
  console.log('ERROR: \n', config, 'should be .json .yaml or .yml')
  argv.showHelp()
})

configs = expandConfigHosts(expandConfigSSHs(configs))

temp.track()

const compilar = function (options, callback) {
  console.log('building from', options.from, 'to', options.to)
  var compiling = spawn('meteor', ['build', '--server-only', '--directory', options.to, '--architecture', 'os.linux.x86_64'], {cwd: options.from, stdio: [0, 1, 2], encoding: 'utf8'})

  compiling.on('close', function (code) {
    if (!code) {
      console.log('build done')
      return callback(null, 0)
    }
    console.log('error building')
    callback(code)
  })
}

const checkConfig = function (config, callback) {
  wait.launchFiber(checkConfig2, config, callback)
}
const checkConfig2 = function * (config, callback) {
  assert(config, 'there is no config')
  assert(config.path, 'there is no path')
  assert(config.ssh, 'there is no ssh config')

  var sshClient = yield [checkSSHConnect, config]
  yield [checkSSHPath, sshClient, config]
  yield [checkSSHPath, sshClient, config]
  yield [checkSSHTouch, sshClient, config]
  yield [checkSSHRemove, sshClient, config]
  yield [checkSSHDocker, sshClient, config]
  callback(null, true)
}
const checkSSHConnect = function (config, callback) {
  var sshClient = new ssh.Client()
  sshClient.on('ready', function () {
    callback(null, sshClient)
  })
  sshClient.on('error', function () {
    console.log(config.ssh)
    assert(false, 'cannot connect to ssh')
  })
  sshClient.connect(config.ssh)
}
const checkSSHPath = function (sshClient, config, callback) {
  sshClient.exec('cd ' + config.path, function (err, stream) {
    if (err) {
      console.log(config.ssh)
      assert(false, 'Error in ssh server')
    }
    stream.on('close', function (code, signal) {
      callback(null, true)
    }).on('data', function (data) {}).stderr.on('data', function (data) {
      assert(false, config.path + ' not found in ' + config.ssh.host)
    })
  })
}
const checkSSHTouch = function (sshClient, config, callback) {
  sshClient.exec('touch ' + path.join(config.path, 'testWritable'), function (err, stream) {
    if (err) {
      console.log(config.ssh)
      assert(false, 'Error in ssh server')
    }
    stream.on('close', function (code, signal) {
      callback(null, true)
    }).on('data', function (data) {}).stderr.on('data', function (data) {
      assert(false, config.path + ' not writable ' + config.ssh.host)
    })
  })
}
const checkSSHRemove = function (sshClient, config, callback) {
  sshClient.exec('rm ' + path.join(config.path, 'testWritable'), function (err, stream) {
    if (err) {
      console.log(config.ssh)
      assert(false, 'Error in ssh server')
    }
    stream.on('close', function (code, signal) {
      callback(null, true)
    }).on('data', function (data) {}).stderr.on('data', function (data) {
      assert(false, config.path + ' not writable ' + config.ssh.host)
    })
  })
}
const checkSSHDocker = function (sshClient, config, callback) {
  sshClient.exec('docker ps', function (err, stream) {
    if (err) {
      console.log(config.ssh)
      assert(false, 'Error in ssh server')
    }
    stream.on('data', function (data) {}).on('close', function (code, signal) {
      sshClient.end()
      callback(null, true)
    }).stderr.on('data', function (data) {
      console.log(data)
      assert(false, config.path + ' install docker ' + config.ssh.host)
    })
  })
}

const upload = function (options, callback) {
  scp.scp(options.from, scp, callback)
}

const main = function* () {
  var dirPath = yield [function (callback) {
    temp.mkdir('deployMeteorBuild', callback)
  }]

  yield [compilar, {from: argv.flags.source, to: dirPath}]

  var configss = configs.slice()

  while (configss[0]) {
    yield [checkConfig, configss.shift()]
  }

  assert(false, 'TODO BIEN')

  configss = configs.slice()
  while (configss[0]) {
    yield [upload, configss.shift()]
  }

  // configs.forEach(function (config) {
  //   wait.launchFiber(upload, config)
  // })
  //
  // config
}

wait.launchFiber(main)
