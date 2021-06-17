#!/usr/bin/env bash

SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do # resolve $SOURCE until the file is no longer a symlink
  DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE" # if $SOURCE was a relative symlink, we need to resolve it relative to the path where the symlink file was located
done
DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"

EXT=".mp4"

if [[ $# -lt 2 ]]; then
    me=$(basename $SOURCE)
    echo "Usage: $me <channel_regex> <output_file>${EXT} (<log_file>)"
    exit 0
fi

log_file=${3:-}
if [[ -n "$log_file" ]]; then
    exec &>$log_file
fi

channel_regex=$1
channels=$DIR/channels_IPTV.m3u8
stream=$(grep -A1 -iP "$channel_regex" $channels | tail -n 1)
if [[ -z "$stream" ]]; then
    echo "Can't find '$channel_regex' in $channels" >&2
    exit 1
fi

recorder=ffmpeg
which $recorder > /dev/null 2>&1
if [[ $? -ne 0 ]]; then
    echo "$recorder is missing"
    sudo apt-get update
    sudo apt-get install -y $recorder
fi

output_file=$2
base_cmd="$recorder -nostdin -err_detect ignore_err -i $stream -c copy -f mpegts $output_file"
i=0
WAIT_SEC=5
while true; do
    if [[ $i -eq 0 ]]; then
        cmd="${base_cmd}${EXT}"
    else
        cmd="${base_cmd}_$((i+1))${EXT}"
    fi

    echo "running $cmd"
    $cmd

    echo "waiting $WAIT_SEC second(s) before trying again..."
    sleep $WAIT_SEC

    ((++i))
done

