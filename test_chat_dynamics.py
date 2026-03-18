import requests
import json
import time
from typing import Any, cast

def test_chat_dynamics():
    url = "http://localhost:5000/api/chat_dynamics"
    params = {
        "icebreaker_gap": 8,
        "ghosting_gap": 4
    }
    
    print("Fetching Chat Dynamics...")
    start_time = time.time()
    try:
        response = requests.get(url, params=params)
        end_time = time.time()
        
        print(f"Request took {end_time - start_time:.2f} seconds")
        
        if response.status_code == 200:
            data: dict[str, Any] = response.json()
            print(f"Success! Got data for {len(data)} senders.")
            
            # Print top 3 senders by message count
            # Use Any cast to bypass broken type checker slicing support for list
            top_senders = cast(Any, sorted(data.items(), key=lambda x: x[1].get('msgs', 0), reverse=True))[:3]
            for sender, stats in top_senders:
                print(f"\n--- {sender} ---")
                print(f"Total Msgs: {stats['msgs']}")
                print(f"  Icebreakers: {stats['icebreakers']}")
                gs = stats.get('ghost_stats', {})
                total_ghost = stats.get('total_ghost_records', 0)
                print(f"  Ghosting ({total_ghost} tracked):")
                for cat, cat_data in gs.items():
                    if cat_data['count'] > 0:
                        print(f"    {cat}: {cat_data['count']} ({cat_data['pct']}%) avg={cat_data['avg_mins']:.1f}m")
                print(f"  Avg Length: {stats['avg_length']} chars")
                print(f"Longest Msg: {stats['max_msg']['len']} chars -> {stats['max_msg']['text']}")
                print(f"Burst Ratio: {stats['burst_ratio']}% (avg {stats['avg_burst']}/seq)")
                print(f"Record Burst: {stats['burst_record']['len']} in a row at {stats['burst_record']['date']}")
                
        else:
            print(f"Failed with status code: {response.status_code}")
            print(response.text)
            
    except requests.exceptions.ConnectionError:
        print("Error: Flask server doesn't seem to be running at http://localhost:5000")

if __name__ == "__main__":
    test_chat_dynamics()
