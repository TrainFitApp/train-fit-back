module.exports = {
  apps: [
    {
      name: "train-fit-back",
      script: "./bin/www",
      instances: 1,
      exec_mode: "fork",
      node_args: "--max-old-space-size=1600",
      max_memory_restart: "1500M",
    }]
}