import sys
from jqdatasdk import auth, get_price, logout
import pandas as pd
import os

# 从命令行参数获取股票代码和日期
stock_symbol = sys.argv[1]
start_date = sys.argv[2]
end_date = sys.argv[3]

# 环境变量获取聚宽账户信息
jq_username = '18868813555'
jq_password = 'Lzx123456'

# 登录聚宽
auth(jq_username, jq_password)

# 获取股票数据
df = get_price(
    stock_symbol,
    start_date=start_date,
    end_date=end_date,
    frequency='daily',
    fields=['open', 'close', 'low', 'high', 'volume', 'money', 'factor',
            'high_limit', 'low_limit', 'avg', 'pre_close', 'paused']
)

# 打印数据以便 Node.js 处理
print(df.to_json())
logout()
